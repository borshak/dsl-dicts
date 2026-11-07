/**
 * Encoding names, runtime support checks and byte-level detection heuristics.
 *
 * @packageDocumentation
 */

import { findLingvoCodePage, WHATWG_ENCODINGS } from '../data/code-pages.js';

export const UTF8 = 'utf-8';
export const UTF16LE = 'utf-16le';
export const UTF16BE = 'utf-16be';

/** Result of resolving an encoding name given by the user or by `#SOURCE_CODE_PAGE`. */
export type EncodingResolution =
  /** Canonical WHATWG name of an encoding the runtime can decode. */
  | { readonly ok: true; readonly encoding: string }
  /** `unknown`: not a name at all; `unsupported`: a known encoding this runtime lacks. */
  | { readonly ok: false; readonly reason: 'unknown' | 'unsupported'; readonly encoding?: string };

/**
 * Resolves a Lingvo code page name (`Cyrillic`) or a WHATWG label (`cp1251`, `UTF-8`) to a
 * canonical encoding name, checking that this runtime's `TextDecoder` supports it. Builds
 * without full ICU data lack most legacy encodings, so support is detected, not assumed.
 */
export function resolveEncoding(name: string): EncodingResolution {
  const trimmed = name.trim();
  const lingvo = findLingvoCodePage(trimmed);
  const label = lingvo?.encoding ?? trimmed;
  if (label === '') return { ok: false, reason: 'unknown' };
  try {
    return { ok: true, encoding: new TextDecoder(label).encoding };
  } catch {
    const known = lingvo?.encoding ?? WHATWG_ENCODINGS.find((e) => e === label.toLowerCase());
    return known === undefined
      ? { ok: false, reason: 'unknown' }
      : { ok: false, reason: 'unsupported', encoding: known };
  }
}

const asciiCompatibility = new Map<string, boolean>();

/**
 * Whether bytes 0x00-0x7F decode to the same ASCII characters, one byte per character. Only
 * such encodings can share the undecided ASCII prefix of a file (UTF-16 and ISO-2022-JP
 * cannot).
 */
export function isAsciiCompatible(encoding: string): boolean {
  let result = asciiCompatibility.get(encoding);
  if (result === undefined) {
    const bytes = new Uint8Array(128);
    for (let i = 0; i < 128; i++) bytes[i] = i;
    let ascii = '';
    for (let i = 0; i < 128; i++) ascii += String.fromCharCode(i);
    try {
      result = new TextDecoder(encoding).decode(bytes) === ascii;
    } catch {
      result = false;
    }
    asciiCompatibility.set(encoding, result);
  }
  return result;
}

/** A byte order mark at the start of the input. */
export interface Bom {
  readonly encoding: string;
  readonly length: number;
}

/** Detects a UTF-8, UTF-16LE or UTF-16BE byte order mark. */
export function detectBom(bytes: Uint8Array): Bom | undefined {
  const [b0, b1, b2] = bytes;
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { encoding: UTF8, length: 3 };
  if (b0 === 0xff && b1 === 0xfe) return { encoding: UTF16LE, length: 2 };
  if (b0 === 0xfe && b1 === 0xff) return { encoding: UTF16BE, length: 2 };
  return undefined;
}

/**
 * Detects UTF-16 without a BOM.
 *
 * 1. GoldenDict's rule: a NUL in byte 1 but not in byte 0 means UTF-16LE, the reverse means
 *    UTF-16BE (an ASCII first character).
 * 2. Otherwise, NUL bytes only at odd (UTF-16LE) or only at even (UTF-16BE) positions of the
 *    sample. This catches files starting with a non-ASCII character. DSL text in UTF-8 or an
 *    8-bit code page contains no NULs; a minimum count keeps a stray NUL from deciding.
 */
export function detectUtf16(sample: Uint8Array): string | undefined {
  if (sample.length < 2) return undefined;
  const [b0, b1] = sample;
  if (b0 !== 0 && b1 === 0) return UTF16LE;
  if (b0 === 0 && b1 !== 0) return UTF16BE;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i & 1) odd++;
      else even++;
    }
  }
  const minimum = Math.max(1, sample.length >> 8);
  if (even === 0 && odd >= minimum) return UTF16LE;
  if (odd === 0 && even >= minimum) return UTF16BE;
  return undefined;
}

/** Index of the first byte >= 0x80 at or after `from`, or -1. */
export function findNonAscii(bytes: Uint8Array, from = 0): number {
  for (let i = from; i < bytes.length; i++) {
    if ((bytes[i] as number) >= 0x80) return i;
  }
  return -1;
}

/**
 * Whether `bytes` are valid UTF-8. With `final: false` the bytes are a window into longer
 * input, so a multi-byte sequence cut at the end does not count as invalid.
 */
export function isValidUtf8(bytes: Uint8Array, final: boolean): boolean {
  try {
    new TextDecoder(UTF8, { fatal: true, ignoreBOM: true }).decode(bytes, { stream: !final });
    return true;
  } catch {
    return false;
  }
}

/** Maps each byte to one character (Latin-1). Exact for ASCII, a placeholder otherwise. */
export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return out;
}
