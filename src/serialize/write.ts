/**
 * `toJsonl` and `toJson`: streaming serialization of a parsed dictionary.
 *
 * @packageDocumentation
 */

import { type Diagnostic, DslError } from '../diagnostics/index.js';
import type { DslEntry, ParsedDsl } from '../parse/parse.js';
import { type DslPlugin, definePlugin, type PluginUse } from '../plugin/plugin.js';
import { createJsonlHeader, type JsonlSummaryRecord } from './format.js';
import { countsByCode, type DiagnosticTally } from './tally.js';

/**
 * Options of {@link toJsonl} and {@link toJson}.
 *
 * @typeParam TOut - What the plugin makes of an entry.
 * @typeParam TOptions - The options of the plugin.
 * @experimental
 */
export interface ToJsonlOptions<TOut = unknown, TOptions = unknown> {
  /**
   * The plugin whose output is exported (its `name@version` goes to the header). Without one
   * the entries are exported as parsed: the AST entries.
   */
  readonly plugin?: DslPlugin<TOut, TOptions>;
  /** The options of the plugin. */
  readonly options?: TOptions;
  /** End the document with a summary record: the entry count and the diagnostics by code. */
  readonly summary?: boolean;
  /**
   * The source of the diagnostic counts of the summary. It has to be the `diagnostics` sink of
   * the options the dictionary was opened with: only then does it see every diagnostic, those
   * of entries and plugins as well. Without it the summary counts `ParsedDsl.diagnostics` and
   * the diagnostics of the AST entries, which is complete for an export without a plugin
   * only: with a plugin it is required (`DSL0001` otherwise).
   */
  readonly tally?: DiagnosticTally;
}

/**
 * Options of {@link toJson}.
 *
 * @experimental
 */
export interface ToJsonOptions<TOut = unknown, TOptions = unknown>
  extends ToJsonlOptions<TOut, TOptions> {
  /** Indent the document by two spaces. Default `false`. */
  readonly pretty?: boolean;
}

/** The parts of an export in order, each already rendered as JSON text. */
interface Piece {
  readonly kind: 'header' | 'entry' | 'summary';
  readonly text: string;
}

/** Renders a value as JSON text, nested `depth` levels deep; `undefined` if it is no JSON. */
type Render = (value: unknown, depth: number) => string | undefined;

const compact: Render = (value) => JSON.stringify(value);

/**
 * Serializes a dictionary as JSONL: lines, each a JSON record ending with `\n`, produced as
 * the entries are read, so that a dictionary of any size is exported in constant memory. The
 * first line is the header record, then one `entry` record per entry, then the optional
 * `summary`; see {@link JSONL_FORMAT}. Records are compact (one line each); a document in
 * which they span several lines is JSON, not JSONL: see {@link toJson}.
 *
 * Without a plugin the payload of an entry record is the AST entry (`DslEntry`, with
 * positions as the dictionary was parsed with them). With a plugin it is what the plugin
 * returns, which has to be JSON-serializable.
 *
 * Reading starts when the first line is requested. The header needs the encoding to be known,
 * and for an ASCII-only file that is only at the end of the input, which is then read
 * before the first line. Errors of reading, of strict mode and of plugins end the iteration
 * as `DslError`s, after the records already produced.
 *
 * @example
 * ```ts
 * const dict = parseDsl(bytes);
 * for await (const line of toJsonl(dict, { plugin: article })) process.stdout.write(line);
 * ```
 *
 * @throws DslError synchronously for invalid arguments (`DSL0001`); `DSL0002` when iterating
 * a dictionary whose entries were read already; `DSL7006` if an entry cannot be serialized.
 * @experimental
 */
export function toJsonl<TOut = unknown, TOptions = unknown>(
  dict: ParsedDsl,
  options: ToJsonlOptions<TOut, TOptions> = {},
): AsyncIterable<string> {
  const pieces = produce(dict, options, compact);
  return {
    async *[Symbol.asyncIterator]() {
      for await (const { kind, text } of pieces) {
        yield kind === 'entry' ? `{"type":"entry","data":${text}}\n` : `${text}\n`;
      }
    },
  };
}

/**
 * Serializes a dictionary as one JSON document, `{ "header": …, "entries": […], "summary": … }`,
 * streamed as chunks of text that concatenate to the document (and end with a newline). Like
 * `toJsonl` it does not hold the dictionary in memory; the document itself, though, can only
 * be read as a whole, so JSONL is the format for large dictionaries.
 *
 * `header` and `summary` are the records of JSONL (with their `type`); `entries` lists the
 * payloads of the entry records. `summary` is there if requested. The other options and the
 * errors are those of {@link toJsonl}.
 *
 * @experimental
 */
export function toJson<TOut = unknown, TOptions = unknown>(
  dict: ParsedDsl,
  options: ToJsonOptions<TOut, TOptions> = {},
): AsyncIterable<string> {
  const { pretty = false } = options;
  if (typeof pretty !== 'boolean') {
    throw DslError.of('invalidArgument', 'The pretty option must be a boolean.');
  }
  const render: Render = (value, depth) => {
    const text = JSON.stringify(value, null, pretty ? 2 : undefined);
    return pretty ? text?.replaceAll('\n', `\n${'  '.repeat(depth)}`) : text;
  };
  const pieces = produce(dict, options, render);
  return {
    async *[Symbol.asyncIterator]() {
      let entries = 0;
      let closed = false;
      const close = (): string => {
        closed = true;
        return entries === 0 ? ']' : pretty ? '\n  ]' : ']';
      };
      for await (const { kind, text } of pieces) {
        if (kind === 'header') {
          yield `${pretty ? '{\n  "header": ' : '{"header":'}${text},${pretty ? '\n  "entries": [' : '"entries":['}`;
        } else if (kind === 'entry') {
          yield `${entries++ === 0 ? '' : ','}${pretty ? '\n    ' : ''}${text}`;
        } else {
          yield `${close()},${pretty ? '\n  "summary": ' : '"summary":'}${text}`;
        }
      }
      yield `${closed ? '' : close()}${pretty ? '\n}' : '}'}\n`;
    },
  };
}

/** Checks the arguments and returns the pieces of the export, produced lazily. */
function produce<TOut, TOptions>(
  dict: ParsedDsl,
  options: ToJsonlOptions<TOut, TOptions>,
  render: Render,
): AsyncIterable<Piece> {
  if (typeof dict !== 'object' || dict === null || typeof dict.entries !== 'function') {
    throw DslError.of('invalidArgument', 'The dictionary must be a result of parseDsl.');
  }
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
  const { plugin, summary = false, tally } = options;
  if (typeof summary !== 'boolean') {
    throw DslError.of('invalidArgument', 'The summary option must be a boolean.');
  }
  if (plugin !== undefined) definePlugin(plugin);
  if (
    tally !== undefined &&
    (typeof tally !== 'object' || tally === null || typeof tally.report !== 'function')
  ) {
    throw DslError.of('invalidArgument', 'The tally option must be a DiagnosticTally.');
  }
  if (summary && plugin !== undefined && tally === undefined) {
    throw DslError.of(
      'invalidArgument',
      'A summary of an export with a plugin needs the tally option: the diagnostics of entries ' +
        'reach only the sink the dictionary was opened with.',
    );
  }
  return { [Symbol.asyncIterator]: () => pieces(dict, options, render) };
}

async function* pieces<TOut, TOptions>(
  dict: ParsedDsl,
  { plugin, options, summary = false, tally }: ToJsonlOptions<TOut, TOptions>,
  render: Render,
): AsyncGenerator<Piece> {
  const header = await dict.header;
  const info = await dict.info;
  const record = createJsonlHeader({ header, info, ...(plugin === undefined ? {} : { plugin }) });
  yield { kind: 'header', text: render(record, 1) as string };

  // Entry diagnostics are counted here only when there is no tally; then it is the AST.
  const counted = new Map<string, number>();
  let count = 0;
  const entries: AsyncIterable<unknown> =
    plugin === undefined
      ? dict.entries()
      : dict.entries({ plugin, options } as PluginUse<TOut, TOptions>);
  for await (const entry of entries) {
    let data = entry;
    if (plugin === undefined) {
      const ast = entry as DslEntry;
      data = withoutCauses(ast);
      if (summary && tally === undefined) {
        for (const { code } of ast.diagnostics ?? [])
          counted.set(code, (counted.get(code) ?? 0) + 1);
      }
    }
    count++;
    yield { kind: 'entry', text: serialized(render, data, count) };
  }

  if (summary) {
    if (tally === undefined) {
      for (const { code } of dict.diagnostics) counted.set(code, (counted.get(code) ?? 0) + 1);
    }
    const record: JsonlSummaryRecord = {
      type: 'summary',
      entries: count,
      diagnostics: tally === undefined ? countsByCode(counted) : tally.byCode,
    };
    yield { kind: 'summary', text: render(record, 1) as string };
  }
}

/** The entry without the `cause` of its diagnostics: an error object, which is no JSON. */
function withoutCauses(entry: DslEntry): DslEntry {
  if (entry.diagnostics === undefined) return entry;
  const diagnostics = entry.diagnostics.map(({ cause: _cause, ...rest }): Diagnostic => rest);
  return { ...entry, diagnostics };
}

/** Renders the payload of an entry; what JSON cannot hold is an error naming the entry. */
function serialized(render: Render, data: unknown, index: number): string {
  let text: string | undefined;
  try {
    text = render(data, 2);
  } catch (error) {
    // BigInt, circular references and throwing `toJSON` methods.
    throw DslError.of('notSerializable', `Entry ${index} cannot be serialized to JSON.`, error);
  }
  if (text === undefined) {
    throw DslError.of('notSerializable', `The output for entry ${index} is not JSON.`);
  }
  return text;
}
