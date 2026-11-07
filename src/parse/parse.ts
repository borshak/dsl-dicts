/**
 * `parseDsl`: the full pipeline, from bytes or text to entries with parsed headwords and
 * bodies.
 *
 * @packageDocumentation
 */

import type { Annotation } from '../companion/annotation.js';
import type { DecodeDslOptions, DecodeInfo } from '../decode/decode.js';
import type { DslSource } from '../decode/source.js';
import {
  createStrictSink,
  type Diagnostic,
  type DiagnosticCounts,
  DiagnosticLog,
  type DiagnosticSink,
  diagnosticsLimitOf,
  dslError,
  type SourcePosition,
  strictSeverity,
} from '../diagnostics/index.js';
import { parseHeadwords } from '../headword/parse.js';
import type { Headword, MarkupNode } from '../markup/ast.js';
import { parseBody } from '../markup/parse.js';
import {
  createDictionaryContext,
  type DslFiles,
  type DslPlugin,
  definePlugin,
  type EntryTransform,
  type PluginUse,
  setupPlugin,
} from '../plugin/plugin.js';
import type { BodyLine, DslHeader, RawEntry } from '../segment/index.js';
import { SegmentedDslImpl } from '../segment/segment.js';

/**
 * How {@link parseDsl} delivers bodies: `ast` parses them into markup nodes, `raw` keeps the
 * body lines for parsing on demand with `parseBody` (see `RawParseDslOptions`).
 */
export type BodyMode = 'ast' | 'raw';

/**
 * Options of {@link parseDsl}: those of `decodeDsl` (`encoding`, `defaultEncoding`,
 * `decompress`, `chunkSize`, `strict`, `diagnostics`, `diagnosticsLimit`, `signal`), plus
 * `positions` and the context of plugins. The `diagnostics` sink, `strict` and
 * `diagnosticsLimit` apply to the diagnostics of every layer: the sink receives them in the
 * order they are found (decoding and segmentation as each chunk is read, then the headwords
 * and body of each entry as it is parsed, and those plugins report).
 *
 * Bodies are parsed into the AST; for raw bodies, see {@link RawParseDslOptions}.
 */
export interface ParseDslOptions extends DecodeDslOptions {
  /**
   * Add `position` and `end` to headwords and markup nodes. Default `true`. Entries always
   * have their positions, and so do diagnostics.
   */
  readonly positions?: boolean;
  /**
   * Abbreviations for `[p]` labels (from `_abrv.dsl`; see `parseAbbreviations`), passed to
   * plugins as `DictionaryContext.abbreviations`. Not used by the parser itself.
   */
  readonly abbreviations?: ReadonlyMap<string, string>;
  /**
   * The annotation (from the `.ann` file; see `parseAnnotation`), passed to plugins as
   * `DictionaryContext.annotation`. A string is taken as an annotation of one section
   * without a language.
   */
  readonly annotation?: Annotation | string;
}

/**
 * Options of {@link parseDsl} in raw mode: the bodies are not parsed, and each entry keeps
 * its body lines (`DslEntry<readonly BodyLine[]>`), to be parsed on demand with `parseBody`:
 * the fastest way to read headwords only. Plugins and exports need parsed bodies, so they
 * refuse a raw dictionary.
 */
export interface RawParseDslOptions extends ParseDslOptions {
  /** Keep the raw body lines. */
  readonly body: 'raw';
}

/**
 * An entry (card): its parsed headwords and its body. Every entry is a fresh plain object.
 * Part of the AST contract, like the markup nodes (see `AST_VERSION`): fields may be added in
 * a minor version, and consumers must ignore those they do not know.
 *
 * @typeParam TBody - `readonly MarkupNode[]` (the default) or `readonly BodyLine[]` (raw
 * mode). A raw entry can be passed as is to `parseBody`, which then resolves `~` in sub-entry
 * headwords against its headwords.
 */
export interface DslEntry<
  TBody extends readonly MarkupNode[] | readonly BodyLine[] = readonly MarkupNode[],
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
   * order; absent if there are none. In raw mode, those of the headwords only.
   */
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * A parsed DSL file: its header and its entries, read lazily.
 *
 * The entries can be read once, either one by one with {@link ParsedDsl.entries} or in
 * batches with {@link ParsedDsl.batches}.
 */
export interface ParsedDsl<TEntry = DslEntry> {
  /**
   * Resolves once the header is complete: at the first entry line, or at the end of input.
   * Awaiting it before reading entries reads ahead that far and buffers what was read.
   * Rejects with the error that stopped reading, or with `DSL0003` if reading was stopped
   * before the header was complete.
   */
  readonly header: Promise<DslHeader>;
  /** What the decoder found out about the input; see `DecodedText.info`. */
  readonly info: Promise<DecodeInfo>;
  /** How bodies are delivered: `raw` with the `body: 'raw'` option, else `ast`. */
  readonly bodyMode: BodyMode;
  /**
   * The diagnostics of every layer reported so far, in the order they were found: decoding,
   * the header and segmentation, the headwords and bodies of the entries read, plugins, and
   * first the companion files of `openDsl`. Only the first `diagnosticsLimit` (default
   * 10 000) are kept, so that reading a large file holds no more than the entries in use;
   * {@link ParsedDsl.diagnosticCounts} counts them all, and the `diagnostics` sink of the
   * options receives them all. The array is the same on every read and grows as the entries
   * are read. Those of an entry are also on the entry (`DslEntry.diagnostics`).
   */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * How many diagnostics were reported so far, of every layer (see `diagnostics`), by code
   * and by severity: exact, whatever the limit. Read after the entries for the whole file.
   *
   * @returns A new object on each call.
   */
  diagnosticCounts(): DiagnosticCounts;
  /**
   * The entries, one by one.
   *
   * @throws DslError `DSL0002` if the entries were already requested.
   */
  entries(): AsyncIterable<TEntry>;
  /**
   * What a plugin makes of the entries, exactly one output per entry, in order.
   *
   * Once the header is known, the plugin is set up once with a context built from it, from
   * the decoding info if already known, and from the `abbreviations` and `annotation`
   * options; its transform is then applied to each entry as it is read. What the plugin
   * reports through `context.diagnostics` is counted with the dictionary's diagnostics.
   * Errors of the plugin end the iteration as a `DslError` naming the plugin (`DSL5001` from
   * `setup`, `DSL5002` from the transform, `DSL0001` for invalid options; see
   * `setupPlugin`).
   *
   * @throws DslError `DSL0002` if the entries were already requested; `DSL0001` for an invalid
   * plugin, or in raw mode (plugins need parsed bodies).
   */
  entries<TOut, TOptions>(
    this: ParsedDsl<DslEntry>,
    use: PluginUse<TOut, TOptions>,
  ): AsyncIterable<TOut>;
  /**
   * The entries in non-empty batches: the fastest way to read them. Batch boundaries depend on
   * the chunking of the input and carry no meaning.
   *
   * @throws DslError `DSL0002` if the entries were already requested.
   */
  batches(): AsyncIterable<readonly TEntry[]>;
  /**
   * What a plugin makes of the entries, in non-empty batches; see the plugin form of
   * {@link ParsedDsl.entries}.
   *
   * @throws DslError like the plugin form of `entries`.
   */
  batches<TOut, TOptions>(
    this: ParsedDsl<DslEntry>,
    use: PluginUse<TOut, TOptions>,
  ): AsyncIterable<readonly TOut[]>;
}

/** An entry in either body mode. */
type AnyEntry = DslEntry | DslEntry<readonly BodyLine[]>;

/** The entries claimed for a plugin. */
interface Plugged<TOut> {
  readonly batches: AsyncIterator<readonly DslEntry[]>;
  /** Waits for the header and sets the plugin up. */
  setup(): Promise<EntryTransform<TOut>>;
  /** Closes the entries and rethrows the error. */
  fail(error: unknown): Promise<never>;
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
 * Problems are reported as diagnostics; with `strict`, the first one of the strict severity
 * stops reading with a `DslError`. The `signal` option cancels reading.
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
 * @example With a plugin (from `dsl-dicts/plugins`):
 * ```ts
 * for await (const { headwords, text } of parseDsl(bytes).entries({ plugin: plainText })) {
 *   console.log(headwords.join(', '), text);
 * }
 * ```
 *
 * @throws DslError synchronously for invalid arguments.
 */
export function parseDsl(
  source: DslSource,
  options: RawParseDslOptions,
): ParsedDsl<DslEntry<readonly BodyLine[]>>;
export function parseDsl(source: DslSource, options?: ParseDslOptions): ParsedDsl<DslEntry>;
export function parseDsl(source: DslSource, options: ParseDslOptions = {}): ParsedDsl<AnyEntry> {
  return new ParsedDslImpl(source, options, {});
}

/** What `openDsl` adds to a parsed dictionary. Internal. */
export interface ParseExtras {
  /** Diagnostics reported before parsing (companion files), already sent to the sink. */
  readonly preface?: readonly Diagnostic[];
  /** The files, for the context of plugins. */
  readonly files?: DslFiles;
}

/** {@link parseDsl} with what `openDsl` adds. Internal. */
export function parseDslWith(
  source: DslSource,
  options: ParseDslOptions,
  extras: ParseExtras,
): ParsedDsl<AnyEntry> {
  return new ParsedDslImpl(source, options, extras);
}

class ParsedDslImpl implements ParsedDsl<AnyEntry> {
  readonly #segmented: SegmentedDslImpl;
  readonly #log: DiagnosticLog;
  /** Records every diagnostic and forwards it to the options' sink, strict mode applied. */
  readonly #sink: DiagnosticSink;
  readonly #positions: boolean;
  readonly #raw: boolean;
  readonly #abbreviations: ReadonlyMap<string, string> | undefined;
  readonly #annotation: Annotation | undefined;
  readonly #files: DslFiles | undefined;

  constructor(source: DslSource, options: ParseDslOptions, extras: ParseExtras) {
    if (typeof options !== 'object' || options === null) {
      throw dslError('invalidArgument', 'Options must be an object.');
    }
    const { positions = true } = options;
    const { body = 'ast' } = options as { readonly body?: unknown };
    if (body !== 'ast' && body !== 'raw') {
      throw dslError('invalidArgument', 'The body option must be "ast" or "raw".');
    }
    if (typeof positions !== 'boolean') {
      throw dslError('invalidArgument', 'The positions option must be a boolean.');
    }
    this.#raw = body === 'raw';
    this.#positions = positions;
    const log = new DiagnosticLog(diagnosticsLimitOf(options.diagnosticsLimit));
    for (const diagnostic of extras.preface ?? []) log.record(diagnostic);
    this.#log = log;
    const outer = options.diagnostics;
    const recorder: DiagnosticSink = {
      report(diagnostic) {
        log.record(diagnostic);
        outer?.report(diagnostic);
      },
    };
    const severity = strictSeverity(options.strict);
    this.#sink = severity === undefined ? recorder : createStrictSink(recorder, severity);
    // Checked here rather than at the first plugin use, like every other option.
    const { abbreviations, annotation } = createDictionaryContext({
      abbreviations: options.abbreviations,
      annotation: options.annotation,
    });
    this.#abbreviations = abbreviations;
    this.#annotation = annotation;
    this.#files = extras.files;
    this.#segmented = new SegmentedDslImpl(source, {
      ...options,
      strict: false,
      diagnostics: this.#sink,
      diagnosticsLimit: 0,
    });
  }

  get bodyMode(): BodyMode {
    return this.#raw ? 'raw' : 'ast';
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.#log.kept;
  }

  diagnosticCounts(): DiagnosticCounts {
    return this.#log.counts();
  }

  get header(): Promise<DslHeader> {
    return this.#segmented.header;
  }

  get info(): Promise<DecodeInfo> {
    return this.#segmented.info;
  }

  entries<TOut>(use?: PluginUse<TOut, unknown>): AsyncIterable<AnyEntry | TOut> {
    const plugged = use === undefined ? undefined : this.#plug(use);
    const batches: AsyncIterator<readonly AnyEntry[]> =
      plugged?.batches ??
      (this.batches()[Symbol.asyncIterator]() as AsyncIterator<readonly AnyEntry[]>);
    let transform: EntryTransform<TOut> | undefined;
    let batch: readonly AnyEntry[] = [];
    let index = 0;
    const iterator: AsyncIterator<AnyEntry | TOut> = {
      next: async () => {
        if (plugged !== undefined) transform ??= await plugged.setup();
        while (index === batch.length) {
          const next = await batches.next();
          if (next.done) return { value: undefined, done: true };
          batch = next.value;
          index = 0;
        }
        const entry = batch[index++] as DslEntry;
        if (transform === undefined) return { value: entry, done: false };
        try {
          return { value: transform(entry), done: false };
        } catch (error) {
          return (plugged as Plugged<TOut>).fail(error);
        }
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

  batches<TOut>(use?: PluginUse<TOut, unknown>): AsyncIterable<readonly (AnyEntry | TOut)[]> {
    if (use !== undefined) return this.#pluginBatches(this.#plug(use));
    const raw = this.#segmented.batches()[Symbol.asyncIterator]();
    const iterator: AsyncIterator<readonly AnyEntry[]> = {
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

  #pluginBatches<TOut>(plugged: Plugged<TOut>): AsyncIterable<readonly TOut[]> {
    const { batches } = plugged;
    let transform: EntryTransform<TOut> | undefined;
    const iterator: AsyncIterator<readonly TOut[]> = {
      next: async () => {
        transform ??= await plugged.setup();
        const next = await batches.next();
        if (next.done) return { value: undefined, done: true };
        try {
          return { value: next.value.map(transform), done: false };
        } catch (error) {
          return plugged.fail(error);
        }
      },
      return: async () => {
        await batches.return?.();
        return { value: undefined, done: true };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  /**
   * Checks a plugin and claims the entries for it. The plugin is set up by `setup()`, once the
   * header is known; any failure closes the entries.
   */
  #plug<TOut>(use: PluginUse<TOut, unknown>): Plugged<TOut> {
    if (typeof use !== 'object' || use === null) {
      throw dslError('invalidArgument', 'The argument must be an object with a plugin.');
    }
    const { plugin, options } = use as { plugin: DslPlugin<TOut, unknown>; options?: unknown };
    definePlugin(plugin);
    if (this.#raw) {
      throw dslError(
        'invalidArgument',
        `Plugin ${plugin.name} needs parsed bodies: leave out the body option "raw".`,
      );
    }
    const batches = this.batches()[Symbol.asyncIterator]() as AsyncIterator<readonly DslEntry[]>;
    const fail = async (error: unknown): Promise<never> => {
      await batches.return?.();
      throw error;
    };
    const setup = async (): Promise<EntryTransform<TOut>> => {
      let header: DslHeader;
      try {
        header = await this.#segmented.header;
      } catch (error) {
        return fail(error);
      }
      const context = createDictionaryContext({
        header,
        diagnostics: this.#sink,
        abbreviations: this.#abbreviations,
        annotation: this.#annotation,
        info: this.#segmented.knownInfo,
        files: this.#files,
      });
      try {
        return setupPlugin(plugin, context, options);
      } catch (error) {
        return fail(error);
      }
    };
    return { batches, setup, fail };
  }

  #entry(entry: RawEntry): AnyEntry {
    const diagnostics: Diagnostic[] = [];
    const outer = this.#sink;
    const sink: DiagnosticSink = {
      report(diagnostic) {
        diagnostics.push(diagnostic);
        outer.report(diagnostic);
      },
    };
    const options = { positions: this.#positions, diagnostics: sink };
    const headwords = parseHeadwords(entry, options);
    const body = this.#raw ? entry.body : parseBody({ headwords, body: entry.body }, options);
    const result: DslEntry = {
      headwords,
      body: body as readonly MarkupNode[],
      position: entry.position,
      end: entry.end,
    };
    return diagnostics.length === 0 ? result : { ...result, diagnostics };
  }
}
