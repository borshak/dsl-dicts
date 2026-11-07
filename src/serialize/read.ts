/**
 * `readJsonl` and `parseJsonlHeader`: a small reader that checks what it reads.
 *
 * @packageDocumentation
 */

import { dslError } from '../diagnostics/index.js';
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
 */
export interface JsonlExpectations {
  /** The `astVersion` the reader understands. */
  readonly astVersion?: number;
  /**
   * The plugin whose output the reader understands: its name, and if `version` is given, a
   * compatible version, by the rules of semantic versioning: the same major version (the
   * minor and patch versions of a plugin's output are compatible), and for a `0.x` version the
   * same minor version too (`0.2.0` and `0.3.0` are not compatible). `null` expects AST
   * entries, that is a document made without a plugin.
   */
  readonly plugin?: {
    /** The plugin name. */
    readonly name: string;
    /** A version of the plugin's output the reader understands, such as `1.0.0`. */
    readonly version?: string;
  } | null;
}

/**
 * A record that follows the header.
 *
 * @typeParam T - The payload of the entries; see {@link readJsonl}.
 */
export type JsonlRecord<T = unknown> = JsonlEntryRecord<T> | JsonlSummaryRecord;

/**
 * A JSONL document being read: the checked header, and the records after it.
 *
 * @typeParam T - The payload of the entries; see {@link readJsonl}.
 */
export interface JsonlReader<T = unknown> {
  /** The header record, checked (see {@link parseJsonlHeader}). */
  readonly header: JsonlHeaderRecord;
  /**
   * The `entry` and `summary` records, checked for their shape (the payload of an entry is not
   * checked). Records of other types are skipped: a later compatible version of the format may
   * add some. Can be iterated once.
   */
  readonly records: AsyncIterable<JsonlRecord<T>>;
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
 */
export function parseJsonlHeader(line: string, expect: JsonlExpectations = {}): JsonlHeaderRecord {
  const value = parseLine(line, 'The header record', 'invalidJsonl');
  const record = value as Record<string, unknown>;
  if (record.type !== 'header') {
    throw dslError('invalidJsonl', `${FAILURE}: the first record is not a header.`);
  }
  if (record.format !== JSONL_FORMAT) {
    throw dslError('invalidJsonl', `${FAILURE}: its format is not ${JSONL_FORMAT}.`);
  }
  const version = record.formatVersion;
  if (!isCount(version) || version < 1) {
    throw dslError('invalidJsonl', `${FAILURE}: formatVersion is not a positive integer.`);
  }
  if (version !== JSONL_FORMAT_VERSION) {
    throw dslError(
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
    throw dslError('invalidJsonl', `${FAILURE}: the header field ${field} is malformed.`);
  };
  if (!isComponent(record.generator)) bad('generator');
  if (!isCount(record.astVersion)) bad('astVersion');
  if (record.plugin !== null && !isComponent(record.plugin)) bad('plugin');
  if (isComponent(record.plugin) && versionOf(record.plugin.version) === undefined) bad('plugin');
  if (!isObject(record.dictionary)) bad('dictionary');
  if (!isObject(record.decode)) bad('decode');
}

function checkExpectations(header: JsonlHeaderRecord, expect: JsonlExpectations): void {
  if (typeof expect !== 'object' || expect === null) {
    throw dslError('invalidArgument', 'The expectations must be an object.');
  }
  if (expect.astVersion !== undefined && header.astVersion !== expect.astVersion) {
    throw dslError(
      'unsupportedAstVersion',
      `The document has AST version ${header.astVersion}; AST version ${expect.astVersion} is expected.`,
    );
  }
  if (expect.plugin === undefined) return;
  const found = header.plugin;
  if (expect.plugin === null) {
    if (found !== null) {
      throw dslError(
        'unsupportedPlugin',
        `The entries are the output of ${found.name}@${found.version}; AST entries are expected.`,
      );
    }
    return;
  }
  const wanted = expect.plugin;
  if (found === null || found.name !== wanted.name) {
    throw dslError(
      'unsupportedPlugin',
      `The entries are ${found === null ? 'AST entries' : `the output of ${found.name}`}; the output of ${wanted.name} is expected.`,
    );
  }
  if (wanted.version !== undefined) {
    const expected = versionOf(wanted.version);
    if (expected === undefined) {
      throw dslError('invalidArgument', `The expected version ${wanted.version} is invalid.`);
    }
    const actual = versionOf(found.version);
    const range = expected.major === 0 ? `0.${expected.minor}` : String(expected.major);
    if (
      actual === undefined ||
      actual.major !== expected.major ||
      (expected.major === 0 && actual.minor !== expected.minor)
    ) {
      throw dslError(
        'unsupportedPlugin',
        `The document has ${found.name}@${found.version}; version ${range}.x is expected.`,
      );
    }
  }
}

/**
 * Reads a JSONL document produced by `toJsonl`, checking the header first.
 *
 * `text` is the document as text, in any chunks: the lines as `toJsonl` writes them (each
 * ends with a newline), or the pieces of a stream (a record may span chunks). A line that
 * ends without a newline is joined with the next chunk. Blank lines are ignored. The header
 * is read and checked with {@link parseJsonlHeader} before `readJsonl` resolves; the records
 * are read as they are iterated.
 *
 * The payload of the entries is not checked: `T` (default `unknown`) is what the caller
 * asserts it to be, typically after checking the plugin with `expect`.
 *
 * @example
 * ```ts
 * const { header, records } = await readJsonl<Article>(lines, {
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
 */
export async function readJsonl<T = unknown>(
  text: AsyncIterable<string> | Iterable<string>,
  expect: JsonlExpectations = {},
): Promise<JsonlReader<T>> {
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
      throw dslError('invalidJsonl', `${FAILURE}: it is empty.`);
    }
    const header = parseJsonlHeader(first, expect);
    return { header, records: records<T>(lines, next, () => number) };
  } catch (error) {
    await lines.return?.();
    throw error;
  }
}

async function* records<T>(
  lines: AsyncIterator<string>,
  next: () => Promise<string | undefined>,
  lineNumber: () => number,
): AsyncGenerator<JsonlRecord<T>> {
  try {
    for (let line = await next(); line !== undefined; line = await next()) {
      const record = parseLine(line, `Line ${lineNumber()}`, 'invalidRecord') as Record<
        string,
        unknown
      >;
      const { type } = record;
      if (typeof type !== 'string') {
        throw dslError('invalidRecord', `Line ${lineNumber()} has no type.`);
      }
      if (type === 'entry') {
        if (!('data' in record)) {
          throw dslError('invalidRecord', `Line ${lineNumber()}: an entry has no data.`);
        }
        yield record as unknown as JsonlEntryRecord<T>;
      } else if (type === 'summary') {
        if (!isCount(record.entries) || !isObject(record.diagnostics)) {
          throw dslError('invalidRecord', `Line ${lineNumber()}: the summary is malformed.`);
        }
        yield record as unknown as JsonlSummaryRecord;
      } else if (type === 'header') {
        throw dslError('invalidRecord', `Line ${lineNumber()}: a second header.`);
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
    throw dslError(code, `${what} is not valid JSON.`, error);
  }
  if (!isObject(value)) throw dslError(code, `${what} is not a JSON object.`);
  return value;
}

/** Re-chunks text into lines, without their line terminators. */
async function* splitLines(text: AsyncIterable<string> | Iterable<string>): AsyncGenerator<string> {
  let pending = '';
  for await (const chunk of text) {
    if (typeof chunk !== 'string') {
      throw dslError('invalidArgument', 'The text must be a sequence of strings.');
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

/** The major and minor versions of a semantic version, or `undefined` if it is not one. */
function versionOf(version: string): { major: number; minor: number } | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.\d+/.exec(version);
  return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]) };
}
