/**
 * Synchronous push decoder: bytes in, normalized text out. Detects the encoding on the way.
 *
 * @packageDocumentation
 */

import { createDiagnostic, type Diagnostic } from '../diagnostics/index.js';
import {
  bytesToLatin1,
  detectBom,
  detectUtf16,
  findNonAscii,
  isAsciiCompatible,
  isValidUtf8,
  resolveEncoding,
  UTF8,
} from './encoding.js';
import type { HeaderScanner } from './header.js';
import { NewlineNormalizer, TextOutput } from './text-output.js';

/**
 * How the encoding was chosen.
 *
 * - `option`: the `encoding` option.
 * - `bom`: a byte order mark.
 * - `heuristic`: NUL bytes typical of UTF-16 without a BOM.
 * - `utf8-detect`: no BOM, and the first non-ASCII bytes are valid UTF-8.
 * - `directive`: the `#SOURCE_CODE_PAGE` header directive.
 * - `default`: the `defaultEncoding` option (or its default, `windows-1251`).
 * - `string`: the input was a string; nothing was decoded.
 */
export type EncodingSource =
  | 'option'
  | 'bom'
  | 'heuristic'
  | 'utf8-detect'
  | 'directive'
  | 'default'
  | 'string';

/** The encoding decision: which encoding the input was decoded with, and why. */
export interface EncodingDecision {
  /**
   * Canonical WHATWG encoding name, e.g. `utf-16le` or `windows-1251`; `utf-16` for string
   * input, which is not decoded (the label is nominal: a JavaScript string is UTF-16).
   */
  readonly encoding: string;
  /** How the encoding was chosen; see {@link EncodingSource}. */
  readonly source: EncodingSource;
  /** A byte order mark was found and stripped. */
  readonly bom: boolean;
}

export interface ByteDecoderOptions {
  /** Canonical name of the forced encoding, if any. */
  readonly encoding?: string;
  /** Canonical name of the 8-bit fallback encoding; may throw if the runtime lacks it. */
  readonly defaultEncoding: () => string;
}

/** Bytes needed for BOM and UTF-16 detection. */
const SNIFF_SIZE = 4096;
/** Bytes from the first non-ASCII byte checked for UTF-8 validity. */
const UTF8_WINDOW = 4096;
/** Upper bound of bytes buffered while looking for `#SOURCE_CODE_PAGE` past that point. */
const HEADER_LOOKAHEAD = 1 << 20;

/**
 * - `sniff`: buffering the first bytes to detect a BOM or UTF-16.
 * - `ascii`: ASCII-compatible input, no non-ASCII byte yet; bytes pass through as ASCII.
 * - `lookahead`: a non-ASCII byte was found; buffering until UTF-8 vs 8-bit can be decided.
 * - `decode`: the encoding is final.
 */
type Phase = 'sniff' | 'ascii' | 'lookahead' | 'decode';

/** Growable byte buffer. */
class ByteBuffer {
  private bytes = new Uint8Array(0);
  length = 0;

  append(chunk: Uint8Array): void {
    const needed = this.length + chunk.length;
    if (needed > this.bytes.length) {
      const grown = new Uint8Array(Math.max(needed, this.bytes.length * 2, 4096));
      grown.set(this.view());
      this.bytes = grown;
    }
    this.bytes.set(chunk, this.length);
    this.length = needed;
  }

  view(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }

  take(): Uint8Array {
    const bytes = this.view();
    this.bytes = new Uint8Array(0);
    this.length = 0;
    return bytes;
  }
}

/**
 * Decodes a byte stream pushed in chunks of any size, detecting the encoding:
 *
 * 1. A forced encoding wins over everything. A BOM is stripped only if it matches.
 * 2. A UTF-8, UTF-16LE or UTF-16BE byte order mark.
 * 3. UTF-16 without a BOM, by NUL bytes ({@link detectUtf16}).
 * 4. Otherwise the input is ASCII-compatible. ASCII decodes identically in UTF-8 and every
 *    8-bit candidate, so ASCII bytes are passed through and the decision is deferred to the
 *    first non-ASCII byte: if the next bytes are valid UTF-8, the encoding is UTF-8, otherwise
 *    the 8-bit code page from `#SOURCE_CODE_PAGE` or the default encoding. Input with no
 *    non-ASCII byte at all gets the 8-bit encoding nominally.
 */
export class ByteDecoder {
  readonly output = new TextOutput();
  decision: EncodingDecision | undefined;
  /** ASCII-compatible input without any non-ASCII byte; the encoding is nominal. */
  asciiOnly = false;

  private phase: Phase = 'sniff';
  private readonly pending = new ByteBuffer();
  private decoder: TextDecoder | undefined;
  private asciiDecoder: TextDecoder | undefined;
  private ended = false;
  private utf8: boolean | undefined;
  private lookahead:
    | { scanner: HeaderScanner; newlines: NewlineNormalizer; fed: number }
    | undefined;
  private directiveProblem: 'unknown' | 'unusable' | undefined;
  private directiveSettled = false;
  private replacementReported = false;

  constructor(
    private readonly options: ByteDecoderOptions,
    private readonly report: (diagnostic: Diagnostic) => void,
  ) {}

  /** The decision is final and the header area has been scanned. */
  get ready(): boolean {
    return this.decision !== undefined && this.output.header.done;
  }

  /** Decodes the next chunk; returns the normalized text that is final so far. */
  push(bytes: Uint8Array): string {
    if (bytes.length === 0) return '';
    switch (this.phase) {
      case 'decode':
        return this.decode(bytes);
      case 'ascii':
        return this.pushAscii(bytes);
      case 'sniff':
        this.pending.append(bytes);
        return this.pending.length < SNIFF_SIZE ? '' : this.sniff();
      case 'lookahead':
        this.pending.append(bytes);
        return this.tryDecide();
    }
  }

  /**
   * Ends the input; returns the remaining text. Afterwards `decision` is always set.
   *
   * @param truncated - The input was cut off: drop an incomplete trailing character instead
   *   of decoding it as U+FFFD.
   */
  end(truncated = false): string {
    if (this.ended) return '';
    this.ended = true;
    let text = '';
    if (this.phase === 'sniff') text += this.sniff();
    if (this.phase === 'lookahead') text += this.tryDecide();
    if (this.phase === 'ascii') {
      this.output.end();
      this.asciiOnly = true;
      this.decision = { ...this.chooseEightBit(), bom: false };
    } else if (this.decoder !== undefined) {
      if (!truncated) text += this.emit(this.decoder.decode());
      this.output.end();
    }
    this.settleDirective();
    return text;
  }

  private sniff(): string {
    const sample = this.pending.take();
    const bom = detectBom(sample);
    const forced = this.options.encoding;
    if (forced !== undefined) {
      if (bom === undefined || bom.encoding === forced) {
        return this.decideAndDecode(forced, 'option', bom, sample);
      }
      this.report(
        createDiagnostic(
          'bomMismatch',
          `The input starts with a ${bom.encoding} byte order mark, but the encoding is forced ` +
            `to ${forced}; the mark is decoded as text.`,
          { byteOffset: 0, position: { offset: 0, line: 1, column: 1 } },
        ),
      );
      return this.decideAndDecode(forced, 'option', undefined, sample);
    }
    if (bom !== undefined) return this.decideAndDecode(bom.encoding, 'bom', bom, sample);
    // A fixed sample size keeps the result independent of how the input is chunked.
    const utf16 = detectUtf16(sample.subarray(0, SNIFF_SIZE));
    if (utf16 !== undefined) return this.decideAndDecode(utf16, 'heuristic', undefined, sample);
    this.phase = 'ascii';
    return this.pushAscii(sample);
  }

  private decideAndDecode(
    encoding: string,
    source: EncodingSource,
    bom: { length: number } | undefined,
    bytes: Uint8Array,
  ): string {
    this.decision = { encoding, source, bom: bom !== undefined };
    this.decoder = new TextDecoder(encoding, { ignoreBOM: true });
    this.phase = 'decode';
    return this.decode(bom === undefined ? bytes : bytes.subarray(bom.length));
  }

  private decode(bytes: Uint8Array): string {
    return this.emit((this.decoder as TextDecoder).decode(bytes, { stream: true }));
  }

  private pushAscii(bytes: Uint8Array): string {
    this.asciiDecoder ??= new TextDecoder();
    const index = findNonAscii(bytes);
    if (index === -1) return this.emit(this.asciiDecoder.decode(bytes));
    const prefix = this.emit(this.asciiDecoder.decode(bytes.subarray(0, index)));
    this.phase = 'lookahead';
    this.pending.append(bytes.subarray(index));
    return prefix + this.tryDecide();
  }

  /** In the `lookahead` phase: decides once enough bytes are buffered (or input ended). */
  private tryDecide(): string {
    const buffered = this.pending.view();
    if (this.utf8 === undefined) {
      // Wait for a byte past the window, so that `final` does not depend on chunking.
      if (buffered.length <= UTF8_WINDOW && !this.ended) return '';
      const final = this.ended && buffered.length <= UTF8_WINDOW;
      this.utf8 = isValidUtf8(buffered.subarray(0, UTF8_WINDOW), final);
    }
    if (this.utf8) return this.decideAndDecode(UTF8, 'utf8-detect', undefined, this.pending.take());

    let directive = this.output.header.directive;
    if (directive === undefined && !this.output.header.done) {
      // The rest of the header is not decoded yet: scan a provisional decoding for the directive.
      this.lookahead ??= {
        scanner: this.output.header.clone(),
        newlines: new NewlineNormalizer(),
        fed: 0,
      };
      const { scanner, newlines } = this.lookahead;
      const limit = Math.min(buffered.length, HEADER_LOOKAHEAD);
      scanner.push(newlines.push(bytesToLatin1(buffered.subarray(this.lookahead.fed, limit))));
      this.lookahead.fed = limit;
      if (this.ended) scanner.end();
      const waiting = !scanner.done && scanner.directive === undefined;
      if (waiting && limit < HEADER_LOOKAHEAD) return '';
      directive = scanner.directive;
    }
    const { encoding, source } = this.chooseEightBit(directive?.value);
    return this.decideAndDecode(encoding, source, undefined, this.pending.take());
  }

  /** The 8-bit encoding from the directive if usable, else the default encoding. */
  private chooseEightBit(
    value = this.output.header.directive?.value,
  ): Pick<EncodingDecision, 'encoding' | 'source'> {
    if (value !== undefined) {
      const resolution = resolveEncoding(value);
      if (resolution.ok && isAsciiCompatible(resolution.encoding)) {
        return { encoding: resolution.encoding, source: 'directive' };
      }
      this.directiveProblem =
        resolution.ok || resolution.reason === 'unsupported' ? 'unusable' : 'unknown';
    }
    return { encoding: this.options.defaultEncoding(), source: 'default' };
  }

  private emit(decoded: string): string {
    const text = this.output.write(decoded, (chunk) => this.checkReplacement(chunk));
    this.settleDirective();
    return text;
  }

  private checkReplacement(text: string): void {
    if (this.replacementReported) return;
    const index = text.indexOf('�');
    if (index === -1) return;
    this.replacementReported = true;
    const encoding = this.decision?.encoding ?? 'the detected encoding';
    this.report(
      createDiagnostic(
        'replacementCharacter',
        `The decoded text contains U+FFFD REPLACEMENT CHARACTER; the input is probably not ` +
          `valid ${encoding}.`,
        { position: this.output.positionIn(text, index) },
      ),
    );
  }

  /** Reports on `#SOURCE_CODE_PAGE` once both the directive and the decision are known. */
  private settleDirective(): void {
    if (this.directiveSettled || this.decision === undefined) return;
    const { header } = this.output;
    const directive = header.directive;
    if (directive === undefined) {
      if (header.done) this.directiveSettled = true;
      return;
    }
    this.directiveSettled = true;
    const { encoding, source } = this.decision;
    const quoted = `#SOURCE_CODE_PAGE "${directive.value}"`;
    const details = { position: { offset: directive.offset, line: directive.line, column: 1 } };
    const resolution = resolveEncoding(directive.value);
    const agrees = resolution.ok && resolution.encoding === encoding;
    if ((source === 'bom' || source === 'heuristic') && !agrees) {
      const reason = source === 'bom' ? 'has a byte order mark' : 'is detected as UTF-16';
      this.report(
        createDiagnostic(
          'codePageIgnored',
          `${quoted} is ignored: the file ${reason} (${encoding}).`,
          details,
        ),
      );
    } else if (source === 'utf8-detect' && !agrees) {
      this.report(
        createDiagnostic(
          'codePageOverridden',
          `${quoted} is ignored: the content is valid UTF-8.`,
          details,
        ),
      );
    } else if (source === 'default' && this.directiveProblem === 'unknown') {
      this.report(
        createDiagnostic(
          'unknownCodePage',
          `${quoted} is not a known code page; using ${encoding}.`,
          details,
        ),
      );
    } else if (source === 'default' && this.directiveProblem === 'unusable') {
      this.report(
        createDiagnostic(
          'unusableCodePage',
          `${quoted} names an encoding that this runtime cannot decode or that is not an ` +
            `8-bit code page; using ${encoding}.`,
          details,
        ),
      );
    }
  }
}
