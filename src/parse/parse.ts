/**
 * `parseDsl`: the full pipeline, from bytes or text to entries with parsed headwords and
 * bodies.
 *
 * @packageDocumentation
 */

import type { DecodeInfo, DecodeOptions } from '../decode/decode.js';
import type { DslSource } from '../decode/source.js';
import {
  createStrictSink,
  type Diagnostic,
  type DiagnosticSink,
  DslError,
  type SourcePosition,
} from '../diagnostics/index.js';
import { parseHeadwords } from '../headword/parse.js';
import type { Headword, MarkupNode } from '../markup/ast.js';
import { parseBody } from '../markup/parse.js';
import {
  type BodyLine,
  type DslHeader,
  type RawEntry,
  type SegmentedDsl,
  segmentDsl,
} from '../segment/index.js';

/**
 * How {@link parseDsl} delivers bodies: `ast` parses them into markup nodes, `raw` keeps the
 * body lines for parsing on demand with `parseBody`.
 *
 * @experimental
 */
export type BodyMode = 'ast' | 'raw';

/**
 * Options of {@link parseDsl}: those of `decodeDsl` (`encoding`, `defaultEncoding`,
 * `decompress`, `chunkSize`, `strict`, `diagnostics`), plus `positions` and `body`. The
 * `diagnostics` sink and `strict` apply to the diagnostics of every layer: the sink receives
 * them in the order they are found (decoding and segmentation as each chunk is read, then the
 * headwords and body of each entry as it is parsed).
 *
 * @experimental
 */
export interface ParseDslOptions extends DecodeOptions {
  /**
   * Add `position` and `end` to headwords and markup nodes. Default `true`. Entries always
   * have their positions, and so do diagnostics.
   */
  readonly positions?: boolean;
  /** Parse bodies (`ast`, the default) or keep the raw body lines (`raw`). */
  readonly body?: BodyMode;
}

/**
 * An entry (card): its parsed headwords and its body. Every entry is a fresh plain object.
 *
 * @typeParam TBody - `MarkupNode[]` (the default, `body: 'ast'`) or `BodyLine[]`
 * (`body: 'raw'`). A raw entry can be passed as is to `parseBody`, which then resolves `~` in
 * sub-entry headwords against its headwords.
 * @experimental
 */
export interface DslEntry<
  TBody extends readonly MarkupNode[] | readonly BodyLine[] = MarkupNode[],
> {
  /** The headwords, at least one, in order. */
  readonly headwords: readonly Headword[];
  /** The body: markup nodes, or the raw body lines. */
  readonly body: TBody;
  /** Position of the first headword line. */
  readonly position: SourcePosition;
  /** Position just after the last character of the entry's last line. */
  readonly end: SourcePosition;
  /**
   * Diagnostics of the entry's headwords and body (codes `DSL3xxx` and `DSL4xxx`), in source
   * order; absent if there are none. With `body: 'raw'`, those of the headwords only.
   */
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * A parsed DSL file: its header and its entries, read lazily.
 *
 * The entries can be read once, either one by one with {@link ParsedDsl.entries} or in
 * batches with {@link ParsedDsl.batches}.
 *
 * @experimental
 */
export interface ParsedDsl<TEntry = DslEntry> {
  /**
   * Resolves once the header is complete: at the first entry line, or at the end of input.
   * Rejects with the error that stopped reading, or with `DSL0003` if reading was stopped
   * before the header was complete.
   */
  readonly header: Promise<DslHeader>;
  /** What the decoder found out about the input; see `DecodedText.info`. */
  readonly info: Promise<DecodeInfo>;
  /**
   * The diagnostics of decoding and segmentation (the header included) reported so far, in
   * order. Those of headwords and bodies are on each entry instead (`DslEntry.diagnostics`):
   * real dictionaries can have millions of them, and reading a large file should hold no more
   * than the entries in use. The `diagnostics` sink of the options receives both kinds, as
   * they are found.
   */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The entries, one by one.
   *
   * @throws DslError `DSL0002` if the entries were already requested.
   */
  entries(): AsyncIterable<TEntry>;
  /**
   * The entries in non-empty batches: the fastest way to read them. Batch boundaries depend on
   * the chunking of the input and carry no meaning.
   *
   * @throws DslError `DSL0002` if the entries were already requested.
   */
  batches(): AsyncIterable<TEntry[]>;
}

/**
 * Parses a DSL dictionary: decoding (`decodeDsl`), segmentation (`segmentDsl`), headwords
 * (`parseHeadwords`) and bodies (`parseBody`), whose rules apply.
 *
 * Reading is lazy and streaming, like `segmentDsl`: input is read as entries are requested,
 * and only the current chunk is held. The only asynchronous step is reading a chunk; its
 * entries are then parsed synchronously. Every entry is parsed on its own, so the result does
 * not depend on how the input is chunked.
 *
 * Problems are reported as diagnostics; with `strict`, the first one of severity `error`
 * stops reading with a `DslError`.
 *
 * @example
 * ```ts
 * const dict = parseDsl(bytes);
 * const header = await dict.header;
 * for await (const entry of dict.entries()) {
 *   console.log(entry.headwords.map((h) => h.text), entry.body);
 * }
 * ```
 *
 * @throws DslError synchronously for invalid arguments.
 * @experimental
 */
export function parseDsl(
  source: DslSource,
  options: ParseDslOptions & { readonly body: 'raw' },
): ParsedDsl<DslEntry<BodyLine[]>>;
export function parseDsl(
  source: DslSource,
  options?: ParseDslOptions & { readonly body?: 'ast' },
): ParsedDsl<DslEntry>;
export function parseDsl(
  source: DslSource,
  options?: ParseDslOptions,
): ParsedDsl<DslEntry | DslEntry<BodyLine[]>>;
export function parseDsl(
  source: DslSource,
  options: ParseDslOptions = {},
): ParsedDsl<DslEntry | DslEntry<BodyLine[]>> {
  return new ParsedDslImpl(source, options);
}

class ParsedDslImpl implements ParsedDsl<DslEntry | DslEntry<BodyLine[]>> {
  readonly #segmented: SegmentedDsl;
  readonly #sink: DiagnosticSink | undefined;
  readonly #positions: boolean;
  readonly #raw: boolean;

  constructor(source: DslSource, options: ParseDslOptions) {
    if (typeof options !== 'object' || options === null) {
      throw DslError.of('invalidArgument', 'Options must be an object.');
    }
    const { body = 'ast', positions = true } = options;
    if (body !== 'ast' && body !== 'raw') {
      throw DslError.of('invalidArgument', 'The body option must be "ast" or "raw".');
    }
    if (typeof positions !== 'boolean') {
      throw DslError.of('invalidArgument', 'The positions option must be a boolean.');
    }
    this.#raw = body === 'raw';
    this.#positions = positions;
    this.#sink = options.strict ? createStrictSink(options.diagnostics) : options.diagnostics;
    this.#segmented = segmentDsl(source, options);
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.#segmented.diagnostics;
  }

  get header(): Promise<DslHeader> {
    return this.#segmented.header;
  }

  get info(): Promise<DecodeInfo> {
    return this.#segmented.info;
  }

  entries(): AsyncIterable<DslEntry | DslEntry<BodyLine[]>> {
    const batches = this.batches()[Symbol.asyncIterator]();
    let batch: (DslEntry | DslEntry<BodyLine[]>)[] = [];
    let index = 0;
    const iterator: AsyncIterator<DslEntry | DslEntry<BodyLine[]>> = {
      next: async () => {
        while (index === batch.length) {
          const next = await batches.next();
          if (next.done) return { value: undefined, done: true };
          batch = next.value;
          index = 0;
        }
        return { value: batch[index++] as DslEntry, done: false };
      },
      return: async () => {
        batch = [];
        index = 0;
        await batches.return?.();
        return { value: undefined, done: true };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  batches(): AsyncIterable<(DslEntry | DslEntry<BodyLine[]>)[]> {
    const raw = this.#segmented.batches()[Symbol.asyncIterator]();
    const iterator: AsyncIterator<(DslEntry | DslEntry<BodyLine[]>)[]> = {
      next: async () => {
        const next = await raw.next();
        if (next.done) return { value: undefined, done: true };
        return { value: next.value.map((entry) => this.#entry(entry)), done: false };
      },
      return: async () => {
        await raw.return?.();
        return { value: undefined, done: true };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  #entry(entry: RawEntry): DslEntry | DslEntry<BodyLine[]> {
    const diagnostics: Diagnostic[] = [];
    const outer = this.#sink;
    const sink: DiagnosticSink = {
      report(diagnostic) {
        diagnostics.push(diagnostic);
        outer?.report(diagnostic);
      },
    };
    const options = { positions: this.#positions, diagnostics: sink };
    const headwords = parseHeadwords(entry, options);
    const body = this.#raw ? entry.body : parseBody({ headwords, body: entry.body }, options);
    const result: DslEntry = {
      headwords,
      body: body as MarkupNode[],
      position: entry.position,
      end: entry.end,
    };
    return diagnostics.length === 0 ? result : { ...result, diagnostics };
  }
}
