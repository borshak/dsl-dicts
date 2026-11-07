/**
 * `segmentDsl`: the public entry point of the segmentation layer.
 *
 * @packageDocumentation
 */

import {
  type DecodedText,
  type DecodeInfo,
  type DecodeOptions,
  decodeDsl,
} from '../decode/decode.js';
import type { DslSource } from '../decode/source.js';
import {
  createStrictSink,
  type Diagnostic,
  type DiagnosticSink,
  DslError,
} from '../diagnostics/index.js';
import { createDecodedTextSegmenter, type Segmenter } from './segmenter.js';
import type { DslHeader, RawEntry } from './types.js';

/**
 * Options of {@link segmentDsl}: those of `decodeDsl`. The `diagnostics` sink and `strict`
 * apply to the diagnostics of both layers.
 *
 * @experimental
 */
export type SegmentOptions = DecodeOptions;

/**
 * A DSL file split into its header and raw entries.
 *
 * The entries can be read once, either one by one with {@link SegmentedDsl.entries} or in
 * batches with {@link SegmentedDsl.batches}.
 *
 * @experimental
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
  /** Every diagnostic of decoding and segmentation reported so far, in order. */
  readonly diagnostics: readonly Diagnostic[];
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
  batches(): AsyncIterable<RawEntry[]>;
}

/**
 * Splits a DSL file into its header and raw entries: `decodeDsl` followed by the synchronous
 * segmenter of `createSegmenter`, whose rules apply.
 *
 * Reading is lazy and streaming: input is read as entries are requested, and only the current
 * chunk of text is held. Problems are reported as diagnostics; with `strict`, the first one of
 * severity `error` stops reading with a `DslError`.
 *
 * @throws DslError synchronously for invalid arguments, like `decodeDsl`.
 * @experimental
 */
export function segmentDsl(source: DslSource, options: SegmentOptions = {}): SegmentedDsl {
  return new SegmentedDslImpl(source, options);
}

class SegmentedDslImpl implements SegmentedDsl {
  readonly diagnostics: Diagnostic[] = [];
  readonly #decoded: DecodedText;
  readonly #segmenter: Segmenter;
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

  constructor(source: DslSource, options: SegmentOptions) {
    if (typeof options !== 'object' || options === null) {
      throw DslError.of('invalidArgument', 'Options must be an object.');
    }
    const outer: DiagnosticSink | undefined = options.strict
      ? createStrictSink(options.diagnostics)
      : options.diagnostics;
    const sink: DiagnosticSink = {
      report: (diagnostic) => {
        this.diagnostics.push(diagnostic);
        outer?.report(diagnostic);
      },
    };
    this.#decoded = decodeDsl(source, { ...options, strict: false, diagnostics: sink });
    this.#segmenter = createDecodedTextSegmenter({ diagnostics: sink });
    this.#header = new Promise<DslHeader>((resolve, reject) => {
      this.#resolveHeader = resolve;
      this.#rejectHeader = reject;
    });
    // Rejections reach whoever awaits `header`; nobody else needs to handle them.
    this.#header.catch(() => {});
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

  batches(): AsyncIterable<RawEntry[]> {
    this.#consume();
    const iterator: AsyncIterator<RawEntry[]> = {
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
      throw DslError.of('alreadyConsumed', 'The entries can be read only once.');
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
    try {
      this.#source ??= this.#decoded[Symbol.asyncIterator]();
      const result = await this.#source.next();
      let batch: RawEntry[];
      if (result.done) {
        this.#done = true;
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
      this.#failed = true;
      this.#error = error;
      this.#finish(error);
    }
  }

  #finish(error: unknown): void {
    this.#done = true;
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
    this.#finish(DslError.of('cancelled', 'Reading was stopped before the header was complete.'));
    // Let a pending read settle before closing the source.
    await this.#inflight;
    await this.#source?.return?.();
  }
}
