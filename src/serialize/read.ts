/**
 * `readJsonl` and `parseJsonlHeader`: a small reader that checks what it reads.
 *
 * @packageDocumentation
 */

import { DslError } from '../diagnostics/index.js';
import {
  JSONL_FORMAT,
  JSONL_FORMAT_VERSION,
  type JsonlEntryRecord,
  type JsonlHeaderRecord,
  type JsonlSummaryRecord,
} from './format.js';

/**
 * What a reader expects of a document, besides the format and its major version, which are
 * always checked.
 *
 * @experimental
 */
export interface JsonlExpectations {
  /** The `astVersion` the reader understands. */
  readonly astVersion?: number;
  /**
   * The plugin whose output the reader understands: its name, and if `version` is given, its
   * major version (the minor and patch versions of a plugin's output are compatible). `null`
   * expects AST entries, that is a document made without a plugin.
   */
  readonly plugin?: { readonly name: string; readonly version?: string } | null;
}

/**
 * A record that follows the header.
 *
 * @experimental
 */
export type JsonlRecord = JsonlEntryRecord | JsonlSummaryRecord;

/**
 * A JSONL document being read: the checked header, and the records after it.
 *
 * @experimental
 */
export interface JsonlReader {
  readonly header: JsonlHeaderRecord;
  /**
   * The `entry` and `summary` records, checked for their shape (the payload of an entry is not
   * checked). Records of other types are skipped: a later compatible version of the format may
   * add some. Can be iterated once.
   */
  readonly records: AsyncIterable<JsonlRecord>;
}

const FAILURE = 'Not a valid dsl-dicts JSONL document';

/**
 * Parses and checks the header record of a JSONL document.
 *
 * Always checked: the line is a JSON object of `type` `header` with the fields of
 * {@link JsonlHeaderRecord}; `format` is `dsl-dicts/jsonl` (`DSL7001` otherwise); and
 * `formatVersion`, the major version of the envelope, is the one this version reads
 * (`DSL7002`). Unknown extra fields are fine. Checked if requested, see
 * {@link JsonlExpectations}: the `astVersion` (`DSL7003`) and the plugin (`DSL7004`).
 *
 * @throws DslError `DSL7001`, `DSL7002`, `DSL7003` or `DSL7004`, as described.
 * @experimental
 */
export function parseJsonlHeader(line: string, expect: JsonlExpectations = {}): JsonlHeaderRecord {
  const value = parseLine(line, 'The header record', 'invalidJsonl');
  const record = value as Record<string, unknown>;
  if (record.type !== 'header') {
    throw DslError.of('invalidJsonl', `${FAILURE}: the first record is not a header.`);
  }
  if (record.format !== JSONL_FORMAT) {
    throw DslError.of('invalidJsonl', `${FAILURE}: its format is not ${JSONL_FORMAT}.`);
  }
  const version = record.formatVersion;
  if (!isCount(version) || version < 1) {
    throw DslError.of('invalidJsonl', `${FAILURE}: formatVersion is not a positive integer.`);
  }
  if (version !== JSONL_FORMAT_VERSION) {
    throw DslError.of(
      'unsupportedFormatVersion',
      `The document is of format version ${version}; this reader reads version ${JSONL_FORMAT_VERSION}.`,
    );
  }
  checkShape(record);
  const header = record as unknown as JsonlHeaderRecord;
  checkExpectations(header, expect);
  return header;
}

/** Checks the fields of a header whose format version is known. */
function checkShape(record: Record<string, unknown>): void {
  const bad = (field: string): never => {
    throw DslError.of('invalidJsonl', `${FAILURE}: the header field ${field} is malformed.`);
  };
  if (!isComponent(record.generator)) bad('generator');
  if (!isCount(record.astVersion)) bad('astVersion');
  if (record.plugin !== null && !isComponent(record.plugin)) bad('plugin');
  if (isComponent(record.plugin) && majorOf(record.plugin.version) === undefined) bad('plugin');
  if (!isObject(record.dictionary)) bad('dictionary');
  if (!isObject(record.decode)) bad('decode');
}

function checkExpectations(header: JsonlHeaderRecord, expect: JsonlExpectations): void {
  if (typeof expect !== 'object' || expect === null) {
    throw DslError.of('invalidArgument', 'The expectations must be an object.');
  }
  if (expect.astVersion !== undefined && header.astVersion !== expect.astVersion) {
    throw DslError.of(
      'unsupportedAstVersion',
      `The document has AST version ${header.astVersion}; AST version ${expect.astVersion} is expected.`,
    );
  }
  if (expect.plugin === undefined) return;
  const found = header.plugin;
  if (expect.plugin === null) {
    if (found !== null) {
      throw DslError.of(
        'unsupportedPlugin',
        `The entries are the output of ${found.name}@${found.version}; AST entries are expected.`,
      );
    }
    return;
  }
  const wanted = expect.plugin;
  if (found === null || found.name !== wanted.name) {
    throw DslError.of(
      'unsupportedPlugin',
      `The entries are ${found === null ? 'AST entries' : `the output of ${found.name}`}; the output of ${wanted.name} is expected.`,
    );
  }
  if (wanted.version !== undefined) {
    const expected = majorOf(wanted.version);
    if (expected === undefined) {
      throw DslError.of('invalidArgument', `The expected version ${wanted.version} is invalid.`);
    }
    if (majorOf(found.version) !== expected) {
      throw DslError.of(
        'unsupportedPlugin',
        `The document has ${found.name}@${found.version}; major version ${expected} is expected.`,
      );
    }
  }
}

/**
 * Reads a JSONL document produced by `toJsonl`, checking the header first.
 *
 * `text` is the document as text, in any chunks: the lines as `toJsonl` writes them (each
 * ends with a newline), or the pieces of a stream (a record may span chunks). A line that
 * ends without a newline is joined with the next chunk. Blank lines are ignored. The header is read and checked with
 * {@link parseJsonlHeader} before `readJsonl` resolves; the records are read as they are
 * iterated.
 *
 * @example
 * ```ts
 * const { header, records } = await readJsonl(lines, {
 *   astVersion: AST_VERSION,
 *   plugin: { name: 'article', version: '1.0.0' },
 * });
 * for await (const record of records) if (record.type === 'entry') use(record.data);
 * ```
 *
 * @throws DslError for the header as in {@link parseJsonlHeader}, with `DSL7001` for an empty
 * document; while iterating, `DSL7005` for a record that is not JSON, not an object or without
 * a `type`, for an `entry` without `data`, for a `summary` without its counts or for a second
 * header.
 * @experimental
 */
export async function readJsonl(
  text: AsyncIterable<string> | Iterable<string>,
  expect: JsonlExpectations = {},
): Promise<JsonlReader> {
  const lines: AsyncIterator<string> = splitLines(text);
  let number = 0;
  const next = async (): Promise<string | undefined> => {
    for (;;) {
      const result = await lines.next();
      if (result.done) return undefined;
      number++;
      if (result.value.trim().length > 0) return result.value;
    }
  };
  let first: string | undefined;
  try {
    first = await next();
    if (first === undefined) {
      throw DslError.of('invalidJsonl', `${FAILURE}: it is empty.`);
    }
    const header = parseJsonlHeader(first, expect);
    return { header, records: records(lines, next, () => number) };
  } catch (error) {
    await lines.return?.();
    throw error;
  }
}

async function* records(
  lines: AsyncIterator<string>,
  next: () => Promise<string | undefined>,
  lineNumber: () => number,
): AsyncGenerator<JsonlRecord> {
  try {
    for (let line = await next(); line !== undefined; line = await next()) {
      const record = parseLine(line, `Line ${lineNumber()}`, 'invalidRecord') as Record<
        string,
        unknown
      >;
      const { type } = record;
      if (typeof type !== 'string') {
        throw DslError.of('invalidRecord', `Line ${lineNumber()} has no type.`);
      }
      if (type === 'entry') {
        if (!('data' in record)) {
          throw DslError.of('invalidRecord', `Line ${lineNumber()}: an entry has no data.`);
        }
        yield record as unknown as JsonlEntryRecord;
      } else if (type === 'summary') {
        if (!isCount(record.entries) || !isObject(record.diagnostics)) {
          throw DslError.of('invalidRecord', `Line ${lineNumber()}: the summary is malformed.`);
        }
        yield record as unknown as JsonlSummaryRecord;
      } else if (type === 'header') {
        throw DslError.of('invalidRecord', `Line ${lineNumber()}: a second header.`);
      }
    }
  } finally {
    await lines.return?.();
  }
}

/** Parses a line into an object. */
function parseLine(line: string, what: string, code: 'invalidJsonl' | 'invalidRecord'): object {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw DslError.of(code, `${what} is not valid JSON.`, error);
  }
  if (!isObject(value)) throw DslError.of(code, `${what} is not a JSON object.`);
  return value;
}

/** Re-chunks text into lines, without their line terminators. */
async function* splitLines(text: AsyncIterable<string> | Iterable<string>): AsyncGenerator<string> {
  let pending = '';
  for await (const chunk of text) {
    if (typeof chunk !== 'string') {
      throw DslError.of('invalidArgument', 'The text must be a sequence of strings.');
    }
    pending += chunk;
    let start = 0;
    for (let end = pending.indexOf('\n', start); end !== -1; end = pending.indexOf('\n', start)) {
      yield pending.slice(start, end).replace(/\r$/, '');
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  if (pending.length > 0) yield pending;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isComponent(value: unknown): value is { name: string; version: string } {
  return isObject(value) && typeof value.name === 'string' && typeof value.version === 'string';
}

/** The major version of a semantic version, or `undefined` if it is not one. */
function majorOf(version: string): number | undefined {
  const match = /^(0|[1-9]\d*)\.\d+\.\d+/.exec(version);
  return match === null ? undefined : Number(match[1]);
}
