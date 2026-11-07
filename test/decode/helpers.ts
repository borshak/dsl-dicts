/**
 * Test helpers: synthetic DSL text, encoders, chunked sources and gzip/dictzip writers.
 * Web-standard APIs only, so the helpers also run in a browser.
 */

import {
  type DecodedText,
  type DecodeInfo,
  type DecodeOptions,
  type Diagnostic,
  type DslSource,
  decodeDsl,
} from '../../src/index.js';

// ---------------------------------------------------------------------------------------------
// Synthetic dictionaries

export type Card = readonly [headword: string, ...body: string[]];

export interface DslTextOptions {
  readonly cards: readonly Card[];
  readonly directive?: string;
  readonly eol?: string;
  readonly name?: string;
}

/** Builds DSL text: a header (with an optional extra directive line) and cards. */
export function dslText({ cards, directive, eol = '\n', name = 'Test' }: DslTextOptions): string {
  const header = [`#NAME "${name}"`, '#INDEX_LANGUAGE "Russian"', '#CONTENTS_LANGUAGE "English"'];
  if (directive !== undefined) header.push(directive);
  const lines = [
    ...header,
    ...cards.flatMap(([hw, ...body]) => [hw, ...body.map((b) => `\t${b}`)]),
  ];
  return lines.join(eol) + eol;
}

export const UNICODE_CARDS: readonly Card[] = [
  ['привет', '[m1][trn]hello[/trn][/m]', '[m2]Ёлка — ёж[/m]'],
  ['café', '[m1]naïve résumé Ångström[/m]'],
  ['clef 𝄞', '[m1]𝄞 G-clef 𝄞𝄞 😀[/m]'],
  ['日本語', '[m1]中文 한국어[/m]'],
];

/** Sample cards per Lingvo code page, using characters of that code page only. */
export const CODE_PAGE_SAMPLES: Readonly<Record<string, readonly [string, readonly Card[]]>> = {
  Latin: [
    'windows-1252',
    [
      ['café', '[m1]naïve résumé “quoted” € ™ Œ ž Ÿ[/m]'],
      ['señor', 'x'],
    ],
  ],
  Cyrillic: [
    'windows-1251',
    [
      ['привет', '[m1]Ёлка — ёж № «ёлки»[/m]'],
      ['слово', 'x'],
    ],
  ],
  EasternEuropean: [
    'windows-1250',
    [
      ['łódź', '[m1]Żółć šžč ő ű Ł[/m]'],
      ['příliš', 'x'],
    ],
  ],
  Greek: [
    'windows-1253',
    [
      ['άλφα', '[m1]Ωμέγα ΐ ά[/m]'],
      ['βήτα', 'x'],
    ],
  ],
  Turkish: [
    'windows-1254',
    [
      ['çağrı', '[m1]İstanbul şığ ğ[/m]'],
      ['ışık', 'x'],
    ],
  ],
  Hebrew: [
    'windows-1255',
    [
      ['שלום', '[m1]עולם[/m]'],
      ['תודה', 'x'],
    ],
  ],
  Arabic: [
    'windows-1256',
    [
      ['سلام', '[m1]مرحبا[/m]'],
      ['شكرا', 'x'],
    ],
  ],
  Baltic: [
    'windows-1257',
    [
      ['ąčėį', '[m1]šųūž Ā Ē[/m]'],
      ['žodis', 'x'],
    ],
  ],
  Vietnamese: [
    'windows-1258',
    [
      ['đèn', '[m1]Nam ơ ư à â ă ê ô Đ[/m]'],
      ['xin', 'x'],
    ],
  ],
};

// ---------------------------------------------------------------------------------------------
// Encoders (independent of the code under test)

export type TestEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | (string & {});

const BOMS: Readonly<Record<string, readonly number[]>> = {
  'utf-8': [0xef, 0xbb, 0xbf],
  'utf-16le': [0xff, 0xfe],
  'utf-16be': [0xfe, 0xff],
};

function utf16(text: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out[2 * i + (bigEndian ? 0 : 1)] = unit >> 8;
    out[2 * i + (bigEndian ? 1 : 0)] = unit & 0xff;
  }
  return out;
}

const reverseTables = new Map<string, Map<string, number>>();

/** Encodes text in a single-byte encoding by inverting the runtime's decoding table. */
function singleByte(text: string, label: string): Uint8Array {
  let table = reverseTables.get(label);
  if (table === undefined) {
    table = new Map();
    const decoder = new TextDecoder(label);
    for (let byte = 255; byte >= 0; byte--) {
      const char = decoder.decode(new Uint8Array([byte]));
      if (char !== '�') table.set(char, byte);
    }
    reverseTables.set(label, table);
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const byte = table.get(text[i] as string);
    if (byte === undefined) throw new Error(`Cannot encode ${JSON.stringify(text[i])} in ${label}`);
    out[i] = byte;
  }
  return out;
}

/** Encodes text; `bom` prepends the byte order mark of a UTF encoding. */
export function encode(text: string, encoding: TestEncoding, bom = false): Uint8Array {
  let body: Uint8Array;
  if (encoding === 'utf-8') body = new TextEncoder().encode(text);
  else if (encoding === 'utf-16le') body = utf16(text, false);
  else if (encoding === 'utf-16be') body = utf16(text, true);
  else body = singleByte(text, encoding);
  if (!bom) return body;
  const mark = BOMS[encoding];
  if (mark === undefined) throw new Error(`No BOM for ${encoding}`);
  return concatBytes([new Uint8Array(mark), body]);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The text after newline normalization, as the decoder should produce it. */
export function normalized(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

// ---------------------------------------------------------------------------------------------
// Sources

/** Splits bytes into chunks of the given sizes (cycled); copies, so chunks are independent. */
export function split(bytes: Uint8Array, sizes: number | readonly number[]): Uint8Array[] {
  const list = typeof sizes === 'number' ? [sizes] : sizes;
  const chunks: Uint8Array[] = [];
  for (let offset = 0, i = 0; offset < bytes.length; i++) {
    const size = Math.max(1, list[i % list.length] as number);
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

export function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
}

export async function* asyncOf(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks;
}

// ---------------------------------------------------------------------------------------------
// Decoding

export interface Decoded {
  readonly text: string;
  readonly chunks: readonly string[];
  readonly info: DecodeInfo;
  readonly diagnostics: readonly Diagnostic[];
  readonly codes: readonly string[];
}

/** Decodes a source completely. */
export async function decodeAll(source: DslSource, options?: DecodeOptions): Promise<Decoded> {
  const decoded: DecodedText = decodeDsl(source, options);
  const chunks: string[] = [];
  for await (const chunk of decoded) chunks.push(chunk);
  const info = await decoded.info;
  return {
    text: chunks.join(''),
    chunks,
    info,
    diagnostics: decoded.diagnostics,
    codes: decoded.diagnostics.map((d) => d.code),
  };
}

/** Runs `fn` and returns the error it throws or rejects with. */
export async function catchError(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error');
}

// ---------------------------------------------------------------------------------------------
// gzip and dictzip

async function transform(bytes: Uint8Array, stream: CompressionStream): Promise<Uint8Array> {
  const output = streamOf([bytes]).pipeThrough(
    stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  const parts: Uint8Array[] = [];
  for (const reader = output.getReader(); ; ) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concatBytes(parts);
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return transform(bytes, new CompressionStream('gzip'));
}

let crcTable: Uint32Array | undefined;

export function crc32(bytes: Uint8Array): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/**
 * Writes a dictzip file: a gzip member whose FEXTRA field holds the `RA` (random access)
 * subfield, around a body made with `CompressionStream('deflate-raw')`.
 *
 * Real dictzip flushes the deflate stream at every chunk boundary, so the chunk table allows
 * random access. A web-standard compressor cannot flush, so the body here is one deflate
 * stream and the table is only structurally valid (the sizes add up to the body length).
 * Sequential decompression, which is all the decoder does, ignores the table.
 */
export async function dictzip(
  data: Uint8Array,
  { chunkLength = 16384, fileName }: { chunkLength?: number; fileName?: string } = {},
): Promise<Uint8Array> {
  const body = await transform(data, new CompressionStream('deflate-raw'));
  const count = Math.max(1, Math.ceil(data.length / chunkLength));
  const sizes = Array.from({ length: count }, (_, i) => {
    const start = Math.floor((body.length * i) / count);
    return Math.floor((body.length * (i + 1)) / count) - start;
  });
  const ra = [...u16(1), ...u16(chunkLength), ...u16(count), ...sizes.flatMap(u16)];
  const extra = [0x52, 0x41, ...u16(ra.length), ...ra];
  const FEXTRA = 4;
  const FNAME = 8;
  const flags = FEXTRA | (fileName === undefined ? 0 : FNAME);
  const header = [0x1f, 0x8b, 8, flags, ...u32(0), 2, 3, ...u16(extra.length), ...extra];
  if (fileName !== undefined) header.push(...new TextEncoder().encode(fileName), 0);
  const trailer = [...u32(crc32(data)), ...u32(data.length)];
  return concatBytes([new Uint8Array(header), body, new Uint8Array(trailer)]);
}
