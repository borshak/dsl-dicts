import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DecodeOptions, Diagnostic } from '../../src/index.js';
import {
  asyncOf,
  CODE_PAGE_SAMPLES,
  concatBytes,
  type Decoded,
  decodeAll,
  dslText,
  encode,
  normalized,
  split,
  streamOf,
  UNICODE_CARDS,
} from './helpers.js';

interface Fixture {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly options?: DecodeOptions;
}

function fixtures(): Fixture[] {
  const list: Fixture[] = [];
  for (const eol of ['\n', '\r\n', '\r']) {
    const text = dslText({ cards: UNICODE_CARDS, eol });
    const suffix = JSON.stringify(eol);
    for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
      for (const bom of [true, false]) {
        const name = `${encoding}${bom ? ' BOM' : ''} ${suffix}`;
        list.push({ name, bytes: encode(text, encoding, bom), text: normalized(text) });
      }
    }
    const cyrillic = dslText({ cards: CODE_PAGE_SAMPLES.Cyrillic?.[1] ?? [], eol });
    list.push({
      name: `windows-1251 default ${suffix}`,
      bytes: encode(cyrillic, 'windows-1251'),
      text: normalized(cyrillic),
    });
  }
  for (const [name, [encoding, cards]] of Object.entries(CODE_PAGE_SAMPLES)) {
    const text = dslText({ cards, directive: `#SOURCE_CODE_PAGE "${name}"`, eol: '\r\n' });
    list.push({ name: `directive ${name}`, bytes: encode(text, encoding), text: normalized(text) });
    const late = dslText({ cards, name: 'Ωμέγα', directive: `#SOURCE_CODE_PAGE "${name}"` });
    if (encoding === 'windows-1253') {
      list.push({ name: `directive after non-ASCII`, bytes: encode(late, encoding), text: late });
    }
  }
  const stale = dslText({ cards: UNICODE_CARDS, directive: '#SOURCE_CODE_PAGE "Cyrillic"' });
  list.push({ name: 'stale directive', bytes: encode(stale, 'utf-8'), text: stale });
  const unknown = dslText({ cards: [['ж', 'x']], directive: '#SOURCE_CODE_PAGE "Klingon"' });
  list.push({ name: 'unknown directive', bytes: encode(unknown, 'windows-1251'), text: unknown });
  const filler = Array.from({ length: 2500 }, (_, i): [string, string] => [`w${i}`, 'ascii body']);
  const late = dslText({ cards: [...filler, ['𝄞 привет', '😀']], eol: '\r\n' });
  list.push({ name: 'late UTF-8', bytes: encode(late, 'utf-8'), text: normalized(late) });
  const mixed = 'a\r\nb\rc\nd\r\r\ne\n\rf\r';
  list.push({
    name: 'mixed newlines',
    bytes: encode(mixed, 'utf-16le', true),
    text: 'a\nb\nc\nd\n\ne\n\nf\n',
  });
  const forced = encode(stale, 'utf-8', true);
  list.push({
    name: 'forced, mismatching BOM',
    bytes: forced,
    text: normalized(new TextDecoder('windows-1252').decode(forced)),
    options: { encoding: 'windows-1252' },
  });
  const odd = encode('ab\r\n𝄞', 'utf-16be', true);
  list.push({ name: 'odd-length UTF-16', bytes: odd.subarray(0, odd.length - 1), text: 'ab\n�' });
  return list;
}

/** The comparable part of a result: everything but the chunk boundaries and error causes. */
function summary(result: Decoded) {
  const strip = ({ cause: _cause, ...rest }: Diagnostic) => rest;
  return { text: result.text, info: result.info, diagnostics: result.diagnostics.map(strip) };
}

describe('chunking invariance', () => {
  for (const fixture of fixtures()) {
    it(fixture.name, async () => {
      const reference = summary(await decodeAll(fixture.bytes, fixture.options));
      expect(reference.text).toBe(fixture.text);
      for (const size of [1, 2, 3, 7, 65536]) {
        const options = { ...fixture.options, chunkSize: size };
        const chunks = split(fixture.bytes, size);
        expect(summary(await decodeAll(chunks, options)), `chunkSize ${size}`).toEqual(reference);
        expect(summary(await decodeAll(asyncOf(chunks), fixture.options))).toEqual(reference);
        expect(summary(await decodeAll(streamOf(chunks), options))).toEqual(reference);
      }
    });
  }

  it('decides on a UTF-8 window that ends exactly at the end of input', async () => {
    // From the first non-ASCII byte there are exactly 4096 bytes, ending with a lone lead byte.
    const bytes = new Uint8Array([0x61, ...Array(2047).fill([0xc3, 0xa9]).flat(), 0x78, 0xc3]);
    for (const size of [1, 2, 4097, 65536]) {
      const result = await decodeAll(split(bytes, size), { chunkSize: size });
      expect(result.info, `chunk size ${size}`).toMatchObject({ encoding: 'windows-1251' });
    }
  });

  it('looks for UTF-16 NUL bytes in the first 4 KiB only', async () => {
    const bytes = new Uint8Array(10_000).fill(0xe0);
    for (let i = 5001; i < bytes.length; i += 2) bytes[i] = 0;
    for (const size of [1, 4096, 65536]) {
      const result = await decodeAll(split(bytes, size), { chunkSize: size });
      expect(result.info, `chunk size ${size}`).toMatchObject({ encoding: 'windows-1251' });
    }
  });

  it('never ends a chunk inside a surrogate pair', async () => {
    const text = '𝄞'.repeat(100);
    for (const source of [text, encode(text, 'utf-16le', true), encode(text, 'utf-8')]) {
      for (const chunkSize of [1, 2, 3, 5]) {
        const { chunks } = await decodeAll(source, { chunkSize });
        for (const chunk of chunks) {
          const last = chunk.charCodeAt(chunk.length - 1);
          expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
        }
        expect(chunks.join('')).toBe(text);
      }
    }
  });
});

describe('properties', () => {
  /** Unicode text rich in newlines and astral characters. Never contains lone surrogates. */
  const unicodeText = fc
    .array(
      fc.oneof(
        fc.constantFrom('\r', '\n', '\r\n', '\n\r', '𝄞', '😀', 'ж', '日'),
        fc.string({ unit: 'binary', maxLength: 8 }),
      ),
      { maxLength: 200 },
    )
    .map((parts) => parts.join(''));
  const splits = fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 8 });
  const chunkSize = fc.oneof(fc.integer({ min: 1, max: 16 }), fc.constant(65536));

  it('round-trips Unicode text through every UTF encoding with a BOM', async () => {
    const encoding = fc.constantFrom('utf-8', 'utf-16le', 'utf-16be');
    await fc.assert(
      fc.asyncProperty(unicodeText, encoding, splits, chunkSize, async (text, enc, sizes, size) => {
        const bytes = encode(text, enc, true);
        const result = await decodeAll(streamOf(split(bytes, sizes)), { chunkSize: size });
        expect(result.text).toBe(normalized(text));
        expect(result.info).toMatchObject({ encoding: enc, source: 'bom', bom: true });
      }),
    );
  });

  it('round-trips forced UTF-16 without a BOM', async () => {
    const encoding = fc.constantFrom('utf-16le', 'utf-16be');
    await fc.assert(
      fc.asyncProperty(unicodeText, encoding, splits, async (text, enc, sizes) => {
        const bytes = encode(text, enc);
        const result = await decodeAll(split(bytes, sizes), { encoding: enc, chunkSize: 3 });
        expect(result.text).toBe(normalized(text));
      }),
    );
  });

  it('detects UTF-8 without a BOM', async () => {
    const text = unicodeText.map((t) => `#NAME "x"\n${t.replaceAll('\0', '')}`);
    await fc.assert(
      fc.asyncProperty(text, splits, chunkSize, async (t, sizes, size) => {
        const result = await decodeAll(split(encode(t, 'utf-8'), sizes), { chunkSize: size });
        expect(result.text).toBe(normalized(t));
        expect(result.info.source).toBe(result.info.asciiOnly ? 'default' : 'utf8-detect');
      }),
    );
  });

  it('decodes 8-bit Cyrillic by default and via the directive', async () => {
    const letters = [...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя'];
    const cyrillic = fc.string({
      unit: fc.oneof(fc.constantFrom(...letters), fc.constantFrom(' ', '\t', '\r', '\n', '[m1]')),
      maxLength: 300,
    });
    const header = fc.constantFrom('', '#NAME "Словарь"\n#SOURCE_CODE_PAGE "Cyrillic"\n');
    await fc.assert(
      fc.asyncProperty(header, cyrillic, splits, chunkSize, async (h, body, sizes, size) => {
        const text = h + body;
        const result = await decodeAll(split(encode(text, 'windows-1251'), sizes), {
          chunkSize: size,
          defaultEncoding: h === '' ? 'windows-1251' : 'windows-1252',
        });
        expect(result.text).toBe(normalized(text));
        expect(result.info.encoding).toBe('windows-1251');
      }),
    );
  });

  it('gives the same result for arbitrary bytes, however they are chunked', async () => {
    const prefix = fc.constantFrom('', '#NAME "x"\n', '#SOURCE_CODE_PAGE "Greek"\n#NAME "');
    const bytes = fc
      .tuple(prefix, fc.uint8Array({ maxLength: 6000 }))
      .map(([p, b]) => concatBytes([new TextEncoder().encode(p), b]));
    await fc.assert(
      fc.asyncProperty(bytes, splits, chunkSize, async (input, sizes, size) => {
        const options: DecodeOptions = { decompress: 'none' };
        const reference = summary(await decodeAll(input, options));
        const result = await decodeAll(split(input, sizes), { ...options, chunkSize: size });
        expect(summary(result)).toEqual(reference);
        expect(result.text).not.toMatch(/\r/);
      }),
      { numRuns: 200 },
    );
  });
});
