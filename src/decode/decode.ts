/**
 * `decodeDsl`: the public entry point of the decoding layer.
 *
 * @packageDocumentation
 */

import {
  createStrictSink,
  type Diagnostic,
  type DiagnosticSink,
  DslError,
} from '../diagnostics/index.js';
import { ByteDecoder, type EncodingDecision } from './byte-decoder.js';
import { isAsciiCompatible, resolveEncoding } from './encoding.js';
import { type DecompressMode, type DecompressStatus, decompress } from './gzip.js';
import { type DslSource, rechunk, toByteChunks } from './source.js';
import { TextOutput } from './text-output.js';

/** Default chunk size: 64 KiB. Larger chunks bring no speed-up, only more memory. */
const DEFAULT_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const DEFAULT_ENCODING = 'windows-1251';

/**
 * Options of {@link decodeDsl}.
 *
 * @experimental
 */
export interface DecodeOptions {
  /**
   * Forced encoding: a Lingvo code page name (`Cyrillic`) or a WHATWG encoding label
   * (`utf-16le`, `cp1251`). Overrides BOM detection, the heuristics and `#SOURCE_CODE_PAGE`.
   * A BOM is stripped only if it matches; otherwise it is decoded as text (`DSL1201`).
   * Ignored for string input.
   */
  readonly encoding?: string;
  /**
   * Encoding of 8-bit input without a usable `#SOURCE_CODE_PAGE`, as a Lingvo name or a
   * WHATWG label of an ASCII-compatible encoding. Default: `windows-1251`, like Lingvo.
   */
  readonly defaultEncoding?: string;
  /** Decompression mode; default `auto` (gzip and dictzip are detected by magic bytes). */
  readonly decompress?: DecompressMode;
  /** Receives diagnostics as they are found, in addition to {@link DecodedText.diagnostics}. */
  readonly diagnostics?: DiagnosticSink;
  /** Throw a `DslError` on the first diagnostic of severity `error`. Default `false`. */
  readonly strict?: boolean;
  /**
   * Size of the text chunks to produce, in input bytes (UTF-16 code units for string input).
   * Default 64 KiB. Mainly useful for testing.
   */
  readonly chunkSize?: number;
}

/**
 * What the decoder found out about the input.
 *
 * @experimental
 */
export interface DecodeInfo extends EncodingDecision {
  /** `gzip` for gzip and dictzip input. */
  readonly compression: 'gzip' | 'none';
  /** Raw value of the first `#SOURCE_CODE_PAGE` in the header area, used or not. */
  readonly directive?: string;
  /**
   * The input is ASCII-compatible and contains no byte >= 0x80, so the choice between UTF-8
   * and an 8-bit code page made no difference; `encoding` is nominal.
   */
  readonly asciiOnly: boolean;
}

/**
 * Decoded, newline-normalized text of a DSL file, as an async sequence of chunks.
 *
 * @experimental
 */
export interface DecodedText extends AsyncIterable<string> {
  /**
   * Resolves once the encoding is final and the header area has been scanned. That is right
   * after the first chunk for most files. For ASCII-compatible input, the choice between UTF-8
   * and an 8-bit code page is made at the first non-ASCII byte (or the end of input).
   *
   * Awaiting `info` before iterating reads ahead as far as needed and buffers the text read,
   * which the iterator then yields; for a huge pure-ASCII file that means the whole text.
   * Rejects with the same error as the iteration, or with `DSL0003` if the iteration is
   * stopped before the info is known.
   */
  readonly info: Promise<DecodeInfo>;
  /** Every diagnostic reported so far, in order. */
  readonly diagnostics: readonly Diagnostic[];
}

type Report = (diagnostic: Diagnostic) => void;
type Publish = (info: DecodeInfo) => void;

interface ResolvedOptions {
  readonly encoding: string | undefined;
  readonly defaultEncoding: () => string;
  readonly decompress: DecompressMode;
  readonly chunkSize: number;
}

/**
 * Decodes a DSL file into normalized text chunks.
 *
 * Pipeline: input chunks, gzip decompression, encoding detection and decoding, newline
 * normalization (`\r\n` and `\r` become `\n`). Chunks are about `chunkSize` long; a chunk never
 * ends between the two halves of a surrogate pair. A leading BOM is removed. The result can be
 * iterated once.
 *
 * Encoding detection, unless `encoding` is given:
 * 1. a UTF-8, UTF-16LE or UTF-16BE byte order mark;
 * 2. UTF-16 without a BOM, recognized by NUL bytes in the first 4 KiB;
 * 3. otherwise ASCII-compatible: UTF-8 if the bytes from the first non-ASCII byte on are valid
 *    UTF-8 (a 4 KiB window), else the code page of `#SOURCE_CODE_PAGE`, else `defaultEncoding`.
 *
 * Problems with the data are reported as diagnostics and decoding goes on; see
 * {@link DecodedText.diagnostics} and the `strict` option. Errors are always `DslError`s.
 *
 * @throws DslError synchronously for invalid arguments: `DSL0001` (bad source or option),
 *   `DSL1002` (unknown encoding), `DSL1003` (encoding unsupported by this runtime).
 * @experimental
 */
export function decodeDsl(source: DslSource, options: DecodeOptions = {}): DecodedText {
  const resolved = resolveOptions(options);
  if (typeof source === 'string') {
    return new DecodedTextImpl(options, (_report, publish) =>
      decodeString(source, resolved.chunkSize, publish),
    );
  }
  const chunks = toByteChunks(source);
  return new DecodedTextImpl(options, (report, publish) =>
    decodeBytes(chunks, resolved, report, publish),
  );
}

function resolveOptions(options: DecodeOptions): ResolvedOptions {
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
  const { decompress = 'auto', chunkSize = DEFAULT_CHUNK_SIZE } = options;
  if (decompress !== 'auto' && decompress !== 'gzip' && decompress !== 'none') {
    throw DslError.of('invalidArgument', `Invalid decompress option: ${String(decompress)}.`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
    throw DslError.of(
      'invalidArgument',
      `chunkSize must be an integer from 1 to ${MAX_CHUNK_SIZE}, got ${String(chunkSize)}.`,
    );
  }
  const encoding =
    options.encoding === undefined ? undefined : resolveOption('encoding', options.encoding);
  let defaultEncoding: () => string;
  if (options.defaultEncoding === undefined) {
    defaultEncoding = () => {
      const resolution = resolveEncoding(DEFAULT_ENCODING);
      if (resolution.ok) return resolution.encoding;
      throw DslError.of(
        'unsupportedEncoding',
        `This runtime cannot decode ${DEFAULT_ENCODING}, the default encoding of 8-bit files; ` +
          'set the encoding or defaultEncoding option.',
      );
    };
  } else {
    const value = resolveOption('defaultEncoding', options.defaultEncoding);
    if (!isAsciiCompatible(value)) {
      throw DslError.of(
        'invalidArgument',
        `defaultEncoding must be an ASCII-compatible encoding, got ${value}.`,
      );
    }
    defaultEncoding = () => value;
  }
  return { encoding, defaultEncoding, decompress, chunkSize };
}

function resolveOption(name: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw DslError.of('invalidArgument', `The ${name} option must be a string.`);
  }
  const resolution = resolveEncoding(value);
  if (resolution.ok) return resolution.encoding;
  if (resolution.reason === 'unsupported') {
    throw DslError.of(
      'unsupportedEncoding',
      `The ${name} option names ${resolution.encoding}, which this runtime cannot decode.`,
    );
  }
  throw DslError.of('unknownEncoding', `The ${name} option is not a known encoding: "${value}".`);
}

async function* decodeBytes(
  chunks: AsyncIterable<Uint8Array>,
  options: ResolvedOptions,
  report: Report,
  publish: Publish,
): AsyncGenerator<string> {
  const status: DecompressStatus = { compressed: false, failed: false };
  const engine = new ByteDecoder(
    { encoding: options.encoding, defaultEncoding: options.defaultEncoding },
    report,
  );
  let published = false;
  const tryPublish = () => {
    if (published || !engine.ready || engine.decision === undefined) return;
    published = true;
    publish(
      withDirective(
        {
          ...engine.decision,
          compression: status.compressed ? 'gzip' : 'none',
          asciiOnly: engine.asciiOnly,
        },
        engine.output.header.directive?.value,
      ),
    );
  };
  const bytes = decompress(chunks, options.decompress, report, status);
  for await (const chunk of rechunk(bytes, options.chunkSize)) {
    const text = engine.push(chunk);
    tryPublish();
    if (text.length > 0) yield text;
  }
  // After a decompression failure the bytes may stop inside a character: drop it silently.
  const text = engine.end(status.failed);
  tryPublish();
  if (text.length > 0) yield text;
}

async function* decodeString(
  source: string,
  chunkSize: number,
  publish: Publish,
): AsyncGenerator<string> {
  const output = new TextOutput();
  const bom = source.charCodeAt(0) === 0xfeff;
  let published = false;
  const tryPublish = () => {
    if (published || !output.header.done) return;
    published = true;
    const info = { encoding: 'utf-16', source: 'string', bom, compression: 'none' } as const;
    publish(withDirective({ ...info, asciiOnly: false }, output.header.directive?.value));
  };
  let start = bom ? 1 : 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + chunkSize);
    // Keep surrogate pairs together.
    const last = source.charCodeAt(end - 1);
    if (end < source.length && last >= 0xd800 && last <= 0xdbff) end++;
    const text = output.write(source.slice(start, end));
    tryPublish();
    if (text.length > 0) yield text;
    start = end;
  }
  output.end();
  tryPublish();
}

function withDirective(info: DecodeInfo, directive: string | undefined): DecodeInfo {
  return directive === undefined ? info : { ...info, directive };
}

/** Single-use result of {@link decodeDsl}: an iterable with a lazily driven `info`. */
class DecodedTextImpl implements DecodedText {
  readonly diagnostics: Diagnostic[] = [];
  readonly #source: AsyncGenerator<string>;
  readonly #info: Promise<DecodeInfo>;
  #resolveInfo: Publish = () => {};
  #rejectInfo: (error: unknown) => void = () => {};
  #infoSettled = false;
  #driving = false;
  #queue: string[] = [];
  #head = 0;
  #done = false;
  #failed = false;
  #error: unknown;
  #inflight: Promise<void> | undefined;
  #iterated = false;

  constructor(
    options: DecodeOptions,
    start: (report: Report, publish: Publish) => AsyncGenerator<string>,
  ) {
    const sink = options.strict ? createStrictSink(options.diagnostics) : options.diagnostics;
    this.#info = new Promise<DecodeInfo>((resolve, reject) => {
      this.#resolveInfo = resolve;
      this.#rejectInfo = reject;
    });
    // Rejections reach whoever awaits `info`; nobody else needs to handle them.
    this.#info.catch(() => {});
    const report: Report = (diagnostic) => {
      this.diagnostics.push(diagnostic);
      sink?.report(diagnostic);
    };
    this.#source = start(report, (info) => {
      this.#infoSettled = true;
      this.#resolveInfo(info);
    });
  }

  get info(): Promise<DecodeInfo> {
    if (!this.#infoSettled && !this.#driving) {
      this.#driving = true;
      void this.#drive();
    }
    return this.#info;
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    if (this.#iterated) {
      throw DslError.of('alreadyConsumed', 'The decoded text can be iterated only once.');
    }
    this.#iterated = true;
    return {
      next: () => this.#next(),
      return: () => this.#return(),
    };
  }

  async #drive(): Promise<void> {
    while (!this.#infoSettled && !this.#done) await this.#pull();
  }

  /** Pulls one chunk into the queue. Never rejects; a failure is stored instead. */
  #pull(): Promise<void> {
    this.#inflight ??= this.#pullOnce().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  async #pullOnce(): Promise<void> {
    try {
      const result = await this.#source.next();
      if (result.done) this.#finish(DslError.of('cancelled', 'Decoding ended without a result.'));
      else this.#queue.push(result.value);
    } catch (error) {
      this.#failed = true;
      this.#error = error;
      this.#finish(error);
    }
  }

  #finish(error: unknown): void {
    this.#done = true;
    if (!this.#infoSettled) {
      this.#infoSettled = true;
      this.#rejectInfo(error);
    }
  }

  async #next(): Promise<IteratorResult<string>> {
    while (this.#head === this.#queue.length && !this.#done) await this.#pull();
    if (this.#head < this.#queue.length) {
      const value = this.#queue[this.#head++] as string;
      if (this.#head === this.#queue.length) {
        this.#queue = [];
        this.#head = 0;
      }
      return { value, done: false };
    }
    if (this.#failed) {
      this.#failed = false;
      throw this.#error;
    }
    return { value: undefined, done: true };
  }

  async #return(): Promise<IteratorResult<string>> {
    this.#queue = [];
    this.#head = 0;
    if (!this.#done) {
      this.#finish(DslError.of('cancelled', 'Decoding was stopped before the info was known.'));
      await this.#source.return(undefined);
    }
    return { value: undefined, done: true };
  }
}
