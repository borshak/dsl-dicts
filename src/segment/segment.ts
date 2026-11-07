/**
 * `segmentDsl`: the public entry point of the segmentation layer.
 *
 * @packageDocumentation
 */

import { abortError, onAbort } from '../decode/abort.js';
import {
  createDecodedText,
  type DecodeDslOptions,
  type DecodedTextImpl,
  type DecodeInfo,
} from '../decode/decode.js';
import type { DslSource } from '../decode/source.js';
import {
  type Diagnostic,
  type DiagnosticCounts,
  DiagnosticLog,
  type DiagnosticSink,
  diagnosticsLimitOf,
  dslError,
  optionsSink,
} from '../diagnostics/index.js';
import { createDecodedTextSegmenter, type Segmenter } from './segmenter.js';
import type { DslHeader, RawEntry } from './types.js';

/**
 * Options of {@link segmentDsl}: those of `decodeDsl`. The `diagnostics` sink, `strict` and
 * `diagnosticsLimit` apply to the diagnostics of both layers.
 */
export type SegmentDslOptions = DecodeDslOptions;

/**
 * A DSL file split into its header and raw entries.
 *
 * The entries can be read once, either one by one with {@link SegmentedDsl.entries} or in
 * batches with {@link SegmentedDsl.batches}.
 */
export interface SegmentedDsl {
  /**
   * Resolves once the header is complete: at the first entry line, or at the end of input.
   * Awaiting it before reading entries reads ahead that far and buffers what was read.
   * Rejects with the error that stopped reading, or with `DSL0003` if reading was stopped
   * before the header was complete.
   */
  readonly header: Promise<DslHeader>;
  /** What the decoder found out about the input; see `DecodedText.info`. */
  readonly info: Promise<DecodeInfo>;
  /**
   * The diagnostics of decoding and segmentation reported so far, in order: the first
   * `diagnosticsLimit` of them. The array is the same on every read and grows as diagnostics
   * are reported.
   */
  readonly diagnostics: readonly Diagnostic[];
  /** How many diagnostics were reported so far, by code and severity, beyond the limit too. */
  diagnosticCounts(): DiagnosticCounts;
  /**
   * The entries, one by one.
   *
   * @throws DslError `DSL0002` if the entries were already requested.
   */
  entries(): AsyncIterable<RawEntry>;
  /**
   * The entries in non-empty batches: the fastest way to read them. Batch boundaries depend on
   * the chunking of the input and carry no meaning.
   *
   * @throws DslError `DSL0002` if the entries were already requested.
   */
  batches(): AsyncIterable<readonly RawEntry[]>;
}

/**
 * Splits a DSL file into its header and raw entries: `decodeDsl`, then a synchronous
 * segmenter fed with the decoded text, chunk by chunk.
 *
 * Rules (Lingvo manual, with GoldenDict's tolerance where Lingvo would reject the file):
 * - Comments `{{ … }}` are removed first, possibly across lines (see the comment rules of
 *   the line reader: `\{{` is not a comment, `\` is not special inside one). A line that
 *   held nothing but comments, spaces and tabs is dropped silently.
 * - Spaces and tabs are the only whitespace: a line starting with any other character
 *   (including U+00A0) is a headword or a directive. Blank means empty or spaces and tabs only.
 * - The preamble is the leading `#` lines, with blank lines allowed between them. A `#` line
 *   after the preamble is ignored with `DSL2006`, wherever it is; it does not end the entry.
 *   A headword starting with `#` must be written `\#`.
 * - Consecutive headword lines share the body: the indented lines that follow. Body lines
 *   lose their indentation, which is kept in `indent`.
 * - Blank lines between entries are normal. Blank lines between headwords, or between the
 *   headwords and the body, are skipped and the headwords merge (`DSL2202`, as GoldenDict:
 *   Lingvo rejects them). Blank lines inside a body are skipped and the body goes on
 *   (`DSL2203`, GoldenDict's "orphan string").
 * - Indented lines before the first headword are ignored (`DSL2201`). Headwords at the end of
 *   input without a body still make an entry, with an empty body (`DSL2204`).
 * - A body line whose first character, after spaces, tabs and tags, is an unescaped `@` is a
 *   sub-entry marker: `subentry-start` if text other than closing tags follows, else
 *   `subentry-end`. Consecutive start lines are headwords of one sub-entry. A start after
 *   other lines of an open sub-entry closes it implicitly (`DSL2301`, like a sub-entry left
 *   open at the end of the entry); an end without an open sub-entry gives `DSL2302`.
 *
 * Reading is lazy and streaming: input is read as entries are requested, and only the current
 * chunk of text is held. Problems are reported as diagnostics; with `strict`, the first one of
 * the strict severity stops reading with a `DslError`.
 *
 * @throws DslError synchronously for invalid arguments, like `decodeDsl`.
 */
export function segmentDsl(source: DslSource, options: SegmentDslOptions = {}): SegmentedDsl {
  return new SegmentedDslImpl(source, options);
}

/** The result of {@link segmentDsl}, with its internals. Internal. */
export class SegmentedDslImpl implements SegmentedDsl {
  readonly #log: DiagnosticLog;
  readonly #decoded: DecodedTextImpl;
  readonly #segmenter: Segmenter;
  readonly #unlisten: () => void;
  #source: AsyncIterator<string> | undefined;
  readonly #header: Promise<DslHeader>;
  #resolveHeader: (header: DslHeader) => void = () => {};
  #rejectHeader: (error: unknown) => void = () => {};
  #headerSettled = false;
  #driving = false;
  #queue: RawEntry[][] = [];
  #head = 0;
  #done = false;
  #failed = false;
  #error: unknown;
  #inflight: Promise<void> | undefined;
  #consumed = false;
  /** Reading was aborted or cancelled: what a pending read brings is dropped. */
  #stopped = false;

  constructor(source: DslSource, options: SegmentDslOptions) {
    if (typeof options !== 'object' || options === null) {
      throw dslError('invalidArgument', 'Options must be an object.');
    }
    const outer = optionsSink(options);
    this.#log = new DiagnosticLog(diagnosticsLimitOf(options.diagnosticsLimit));
    const sink: DiagnosticSink = {
      report: (diagnostic) => {
        this.#log.record(diagnostic);
        outer?.report(diagnostic);
      },
    };
    this.#decoded = createDecodedText(source, {
      ...options,
      strict: false,
      diagnostics: sink,
      diagnosticsLimit: 0,
    });
    this.#segmenter = createDecodedTextSegmenter({ diagnostics: sink });
    this.#header = new Promise<DslHeader>((resolve, reject) => {
      this.#resolveHeader = resolve;
      this.#rejectHeader = reject;
    });
    // Rejections reach whoever awaits `header`; nobody else needs to handle them.
    this.#header.catch(() => {});
    const { signal } = options;
    // The decoder fails the reads in progress; this fails the header when nothing is read.
    this.#unlisten = onAbort(signal, () => {
      if (this.#done || signal === undefined) return;
      this.#stopped = true;
      const error = abortError(signal);
      this.#queue = [];
      this.#head = 0;
      this.#failed = true;
      this.#error = error;
      this.#finish(error);
    });
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.#log.kept;
  }

  diagnosticCounts(): DiagnosticCounts {
    return this.#log.counts();
  }

  /** The decoding info if it is already known, without reading. Internal. */
  get knownInfo(): DecodeInfo | undefined {
    return this.#decoded.knownInfo;
  }

  get header(): Promise<DslHeader> {
    if (!this.#headerSettled && !this.#driving) {
      this.#driving = true;
      void this.#drive();
    }
    return this.#header;
  }

  get info(): Promise<DecodeInfo> {
    return this.#decoded.info;
  }

  entries(): AsyncIterable<RawEntry> {
    this.#consume();
    let batch: RawEntry[] = [];
    let index = 0;
    const iterator: AsyncIterator<RawEntry> = {
      next: async () => {
        while (index === batch.length) {
          const next = await this.#nextBatch();
          if (next === undefined) return { value: undefined, done: true };
          batch = next;
          index = 0;
        }
        return { value: batch[index++] as RawEntry, done: false };
      },
      return: async () => {
        batch = [];
        index = 0;
        await this.#cancel();
        return { value: undefined, done: true };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  batches(): AsyncIterable<readonly RawEntry[]> {
    this.#consume();
    const iterator: AsyncIterator<readonly RawEntry[]> = {
      next: async () => {
        const batch = await this.#nextBatch();
        return batch === undefined
          ? { value: undefined, done: true }
          : { value: batch, done: false };
      },
      return: async () => {
        await this.#cancel();
        return { value: undefined, done: true };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  #consume(): void {
    if (this.#consumed) {
      throw dslError('alreadyConsumed', 'The entries can be read only once.');
    }
    this.#consumed = true;
  }

  async #drive(): Promise<void> {
    while (!this.#headerSettled && !this.#done) await this.#pull();
  }

  /** Reads one text chunk into the queue. Never rejects; a failure is stored instead. */
  #pull(): Promise<void> {
    this.#inflight ??= this.#pullOnce().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  async #pullOnce(): Promise<void> {
    if (this.#done) return;
    try {
      this.#source ??= this.#decoded[Symbol.asyncIterator]();
      const result = await this.#source.next();
      if (this.#stopped) return;
      let batch: RawEntry[];
      if (result.done) {
        this.#done = true;
        this.#unlisten();
        batch = this.#segmenter.end();
      } else {
        batch = this.#segmenter.push(result.value);
      }
      if (batch.length > 0) this.#queue.push(batch);
      const header = this.#segmenter.header;
      if (header !== undefined && !this.#headerSettled) {
        this.#headerSettled = true;
        this.#resolveHeader(header);
      }
    } catch (error) {
      if (this.#stopped) return;
      this.#failed = true;
      this.#error = error;
      this.#finish(error);
    }
  }

  #finish(error: unknown): void {
    this.#done = true;
    this.#unlisten();
    if (!this.#headerSettled) {
      this.#headerSettled = true;
      this.#rejectHeader(error);
    }
  }

  async #nextBatch(): Promise<RawEntry[] | undefined> {
    while (this.#head === this.#queue.length && !this.#done) await this.#pull();
    if (this.#head < this.#queue.length) {
      const batch = this.#queue[this.#head++] as RawEntry[];
      if (this.#head === this.#queue.length) {
        this.#queue = [];
        this.#head = 0;
      }
      return batch;
    }
    if (this.#failed) {
      this.#failed = false;
      throw this.#error;
    }
    return undefined;
  }

  async #cancel(): Promise<void> {
    this.#queue = [];
    this.#head = 0;
    if (this.#done) return;
    this.#stopped = true;
    this.#finish(dslError('cancelled', 'Reading was stopped before the header was complete.'));
    // Let a pending read settle before closing the source.
    await this.#inflight;
    await this.#source?.return?.();
  }
}
