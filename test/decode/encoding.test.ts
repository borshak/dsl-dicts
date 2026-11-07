import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DecodeOptions, DslError, decodeDsl } from '../../src/index.js';
import {
  type Card,
  CODE_PAGE_SAMPLES,
  catchError,
  concatBytes,
  decodeAll,
  dslText,
  encode,
  normalized,
  UNICODE_CARDS,
} from './helpers.js';

const unicode = dslText({ cards: UNICODE_CARDS });
const cyrillic = dslText({ cards: CODE_PAGE_SAMPLES.Cyrillic?.[1] ?? [] });

describe('BOM detection', () => {
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
    it(`detects and strips a ${encoding} BOM`, async () => {
      const result = await decodeAll(encode(unicode, encoding, true));
      expect(result.text).toBe(unicode);
      expect(result.info).toMatchObject({ encoding, source: 'bom', bom: true });
      expect(result.codes).toEqual([]);
    });
  }

  it('strips only the BOM, not a second U+FEFF', async () => {
    const result = await decodeAll(encode('﻿x\n', 'utf-16le', true));
    expect(result.text).toBe('﻿x\n');
  });
});

describe('UTF-16 without BOM', () => {
  for (const encoding of ['utf-16le', 'utf-16be'] as const) {
    it(`detects ${encoding} with an ASCII first character (byte 0/1 rule)`, async () => {
      const result = await decodeAll(encode(unicode, encoding));
      expect(result.text).toBe(unicode);
      expect(result.info).toMatchObject({ encoding, source: 'heuristic', bom: false });
    });

    it(`detects ${encoding} with a non-ASCII first character (NUL parity)`, async () => {
      const text = 'привет\n\t[m1]hello[/m]\nмир\n\t[m1]world[/m]\n';
      const result = await decodeAll(encode(text, encoding));
      expect(result.text).toBe(text);
      expect(result.info).toMatchObject({ encoding, source: 'heuristic' });
    });
  }

  it('does not take a stray NUL in 8-bit text for UTF-16', async () => {
    const text = `${'Ё'.repeat(1000)}\0${'ж'.repeat(3000)}\n`;
    const result = await decodeAll(encode(text, 'windows-1251'));
    expect(result.info).toMatchObject({ encoding: 'windows-1251', source: 'default' });
    expect(result.text).toBe(text);
  });
});

describe('UTF-8 without BOM', () => {
  it('detects UTF-8 at the first non-ASCII byte', async () => {
    const result = await decodeAll(encode(unicode, 'utf-8'));
    expect(result.text).toBe(unicode);
    expect(result.info).toMatchObject({ encoding: 'utf-8', source: 'utf8-detect', bom: false });
    expect(result.info.asciiOnly).toBe(false);
  });

  it('detects UTF-8 whose first non-ASCII byte is beyond 64 KiB', async () => {
    const filler = Array.from({ length: 3000 }, (_, i): [string, string] => [
      `word${i}`,
      '[m1]plain ascii body text[/m]',
    ]);
    const text = dslText({ cards: [...filler, ['привет', '[m1]hello 𝄞[/m]']] });
    const bytes = encode(text, 'utf-8');
    expect(bytes.indexOf(0xd0)).toBeGreaterThan(64 * 1024);
    const result = await decodeAll(bytes);
    expect(result.text).toBe(text);
    expect(result.info).toMatchObject({ encoding: 'utf-8', source: 'utf8-detect' });
  });

  it('detects UTF-8 when the window ends inside a multi-byte sequence', async () => {
    // The 4 KiB window starting at the first non-ASCII byte ends in the middle of a character.
    const text = `#NAME "x"\n${'é'.repeat(2047)}𝄞${'é'.repeat(10)}\n`;
    const result = await decodeAll(encode(text, 'utf-8'), { chunkSize: 7 });
    expect(result.text).toBe(text);
    expect(result.info.source).toBe('utf8-detect');
  });

  it('chooses the 8-bit encoding for a truncated UTF-8 sequence at the end of input', async () => {
    const result = await decodeAll(new Uint8Array([0x61, 0xd0]));
    expect(result.info).toMatchObject({ encoding: 'windows-1251', source: 'default' });
    expect(result.text).toBe('aР');
  });

  it('reports U+FFFD for invalid UTF-8 after the detection window', async () => {
    const valid = encode(`#NAME "x"\n${'ж'.repeat(3000)}\n`, 'utf-8');
    const result = await decodeAll(concatBytes([valid, new Uint8Array([0xff, 0x0a])]));
    expect(result.info.encoding).toBe('utf-8');
    expect(result.codes).toEqual(['DSL1206']);
    expect(result.diagnostics[0]?.position).toEqual({
      offset: 10 + 3000 + 1,
      line: 3,
      column: 1,
    });
  });
});

describe('8-bit code pages', () => {
  for (const [name, [encoding, cards]] of Object.entries(CODE_PAGE_SAMPLES)) {
    it(`decodes ${encoding} named by #SOURCE_CODE_PAGE "${name}"`, async () => {
      const text = dslText({ cards, directive: `#SOURCE_CODE_PAGE "${name}"` });
      const result = await decodeAll(encode(text, encoding));
      expect(result.text).toBe(text);
      expect(result.info).toMatchObject({ encoding, source: 'directive', directive: name });
      expect(result.codes).toEqual([]);
    });
  }

  it('accepts lenient directive spellings', async () => {
    const [encoding, cards] = CODE_PAGE_SAMPLES.EasternEuropean ?? ['', []];
    for (const directive of [
      '#source_code_page "eastern_european"',
      '#SOURCE_CODE_PAGE "Eastern European"',
      '#SOURCE_CODE_PAGE\t"EASTERN-EUROPEAN"',
      '#SOURCE_CODE_PAGE EasternEuropean',
    ]) {
      const text = dslText({ cards, directive });
      const result = await decodeAll(encode(text, encoding));
      expect(result.info.encoding, directive).toBe(encoding);
      expect(result.text).toBe(text);
    }
  });

  it('accepts a WHATWG label as the directive', async () => {
    const cards: Card[] = [['привет', '[m1]Ёлка ёж[/m]']];
    const text = dslText({ cards, directive: '#SOURCE_CODE_PAGE "koi8-r"' });
    const result = await decodeAll(encode(text, 'koi8-r'));
    expect(result.info).toMatchObject({ encoding: 'koi8-r', source: 'directive' });
    expect(result.text).toBe(text);
  });

  it('finds a directive that follows a non-ASCII header line', async () => {
    const [, cards] = CODE_PAGE_SAMPLES.Latin ?? ['', []];
    const text = dslText({ cards, name: 'Diccionário', directive: '#SOURCE_CODE_PAGE "Latin"' });
    for (const chunkSize of [1, 5, 65536]) {
      const result = await decodeAll(encode(text, 'windows-1252'), { chunkSize });
      expect(result.info).toMatchObject({ encoding: 'windows-1252', source: 'directive' });
      expect(result.text).toBe(text);
    }
  });

  it('defaults to windows-1251 without a directive', async () => {
    const result = await decodeAll(encode(cyrillic, 'windows-1251'));
    expect(result.text).toBe(cyrillic);
    expect(result.info).toMatchObject({ encoding: 'windows-1251', source: 'default' });
    expect(result.info.directive).toBeUndefined();
    expect(result.codes).toEqual([]);
  });

  it('uses defaultEncoding, given as a label or a Lingvo name', async () => {
    const [, cards] = CODE_PAGE_SAMPLES.Latin ?? ['', []];
    const text = dslText({ cards });
    for (const defaultEncoding of ['windows-1252', 'Latin', 'cp1252']) {
      const result = await decodeAll(encode(text, 'windows-1252'), { defaultEncoding });
      expect(result.info).toMatchObject({ encoding: 'windows-1252', source: 'default' });
      expect(result.text).toBe(text);
    }
  });

  it('warns about an unknown directive and falls back to the default', async () => {
    const text = dslText({
      cards: CODE_PAGE_SAMPLES.Cyrillic?.[1] ?? [],
      directive: '#SOURCE_CODE_PAGE "Klingon"',
    });
    const result = await decodeAll(encode(text, 'windows-1251'));
    expect(result.text).toBe(text);
    expect(result.info).toMatchObject({ encoding: 'windows-1251', source: 'default' });
    expect(result.info.directive).toBe('Klingon');
    expect(result.codes).toEqual(['DSL1202']);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      position: { line: 4, column: 1, offset: text.indexOf('#SOURCE_CODE_PAGE') },
    });
  });

  it('warns about a directive naming a non-ASCII-compatible encoding', async () => {
    const text = dslText({ cards: [['ж', 'x']], directive: '#SOURCE_CODE_PAGE "utf-16le"' });
    const result = await decodeAll(encode(text, 'windows-1251'));
    expect(result.info).toMatchObject({ encoding: 'windows-1251', source: 'default' });
    expect(result.codes).toEqual(['DSL1203']);
  });

  it('warns about an unknown directive in an ASCII-only file', async () => {
    const text = dslText({ cards: [['word', 'x']], directive: '#SOURCE_CODE_PAGE "Klingon"' });
    const result = await decodeAll(encode(text, 'utf-8'));
    expect(result.info).toMatchObject({ source: 'default', asciiOnly: true });
    expect(result.codes).toEqual(['DSL1202']);
  });

  it('reports pure ASCII input as asciiOnly with the nominal 8-bit encoding', async () => {
    const text = dslText({ cards: [['word', 'x']], directive: '#SOURCE_CODE_PAGE "Latin"' });
    const result = await decodeAll(encode(text, 'utf-8'));
    expect(result.text).toBe(text);
    expect(result.info).toMatchObject({
      encoding: 'windows-1252',
      source: 'directive',
      asciiOnly: true,
    });
  });

  it('decodes the 0x80-0x9F block of windows-1252 as such, not as Latin-1', async () => {
    const text = dslText({
      cards: [['x', '€ ‚ƒ„…†‡ˆ‰Š‹Œ Ž ‘’“”•–—˜™š›œ žŸ']],
      directive: '#SOURCE_CODE_PAGE "Latin"',
    });
    const result = await decodeAll(encode(text, 'windows-1252'));
    expect(result.text).toBe(text);
  });
});

describe('stale directives', () => {
  it('prefers valid UTF-8 over an 8-bit directive, with a warning', async () => {
    const text = dslText({ cards: UNICODE_CARDS, directive: '#SOURCE_CODE_PAGE "Cyrillic"' });
    const result = await decodeAll(encode(text, 'utf-8'));
    expect(result.text).toBe(text);
    expect(result.info).toMatchObject({ encoding: 'utf-8', source: 'utf8-detect' });
    expect(result.codes).toEqual(['DSL1205']);
    expect(result.diagnostics[0]?.severity).toBe('warning');
  });

  it('notes a directive in a file with a BOM', async () => {
    const text = dslText({ cards: UNICODE_CARDS, directive: '#SOURCE_CODE_PAGE "Cyrillic"' });
    for (const encoding of ['utf-16le', 'utf-8'] as const) {
      const result = await decodeAll(encode(text, encoding, true));
      expect(result.info).toMatchObject({ encoding, source: 'bom', directive: 'Cyrillic' });
      expect(result.codes).toEqual(['DSL1204']);
      expect(result.diagnostics[0]?.severity).toBe('info');
    }
  });

  it('notes a directive in UTF-16 detected without a BOM', async () => {
    const text = dslText({ cards: UNICODE_CARDS, directive: '#SOURCE_CODE_PAGE "Cyrillic"' });
    const result = await decodeAll(encode(text, 'utf-16be'));
    expect(result.info.source).toBe('heuristic');
    expect(result.codes).toEqual(['DSL1204']);
  });

  it('is silent when the directive agrees with the detected encoding', async () => {
    const text = dslText({ cards: UNICODE_CARDS, directive: '#SOURCE_CODE_PAGE "UTF-8"' });
    const result = await decodeAll(encode(text, 'utf-8', true));
    expect(result.codes).toEqual([]);
  });

  it('ignores directive-like lines after the header area', async () => {
    const text = `${dslText({ cards: [['ж', 'x']] })}#SOURCE_CODE_PAGE "Latin"\n`;
    const result = await decodeAll(encode(text, 'windows-1251'));
    expect(result.info.source).toBe('default');
    expect(result.info.directive).toBeUndefined();
  });
});

describe('forced encoding', () => {
  const cases: [string, Uint8Array, DecodeOptions, string, string[]][] = [
    [
      'UTF-16LE with matching BOM',
      encode(unicode, 'utf-16le', true),
      { encoding: 'utf-16le' },
      unicode,
      [],
    ],
    ['UTF-8 with matching BOM', encode(unicode, 'utf-8', true), { encoding: 'UTF-8' }, unicode, []],
    ['an alias label', encode(unicode, 'utf-16le', true), { encoding: 'ucs-2' }, unicode, []],
    ['a Lingvo name', encode(cyrillic, 'windows-1251'), { encoding: 'Cyrillic' }, cyrillic, []],
  ];
  for (const [title, bytes, options, expected, codes] of cases) {
    it(`decodes ${title}`, async () => {
      const result = await decodeAll(bytes, options);
      expect(result.text).toBe(expected);
      expect(result.info.source).toBe('option');
      expect(result.codes).toEqual(codes);
    });
  }

  it('reports the BOM state', async () => {
    expect((await decodeAll(encode(unicode, 'utf-8', true), { encoding: 'utf-8' })).info.bom).toBe(
      true,
    );
    expect((await decodeAll(encode(unicode, 'utf-8'), { encoding: 'utf-8' })).info.bom).toBe(false);
  });

  it('keeps a mismatching BOM as text and warns', async () => {
    const bytes = encode(unicode, 'utf-8', true);
    const result = await decodeAll(bytes, { encoding: 'windows-1251' });
    expect(result.text).toBe(normalized(new TextDecoder('windows-1251').decode(bytes)));
    expect(result.text.startsWith('п»ї#NAME')).toBe(true);
    expect(result.info).toMatchObject({ encoding: 'windows-1251', source: 'option', bom: false });
    expect(result.codes).toEqual(['DSL1201']);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'warning', byteOffset: 0 });
  });

  it('keeps a UTF-16 BOM decoded as UTF-8 as text', async () => {
    const bytes = encode(unicode, 'utf-16le', true);
    const result = await decodeAll(bytes, { encoding: 'utf-8' });
    const expected = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(result.text).toBe(normalized(expected));
    expect(result.codes).toContain('DSL1201');
  });

  it('overrides the directive, valid UTF-8 detection and the NUL heuristic', async () => {
    const latin = dslText({
      cards: CODE_PAGE_SAMPLES.Latin?.[1] ?? [],
      directive: '#SOURCE_CODE_PAGE "Latin"',
    });
    const inputs: [Uint8Array, string][] = [
      [encode(latin, 'windows-1252'), 'windows-1251'],
      [encode(unicode, 'utf-8'), 'windows-1252'],
      [encode(unicode, 'utf-16le'), 'utf-8'],
    ];
    for (const [bytes, encoding] of inputs) {
      const result = await decodeAll(bytes, { encoding });
      expect(result.info).toMatchObject({ encoding, source: 'option' });
      expect(result.text).toBe(normalized(new TextDecoder(encoding).decode(bytes)));
      expect(result.codes.filter((code) => code !== 'DSL1206')).toEqual([]);
    }
  });

  it('throws DSL1002 for an unknown forced encoding', async () => {
    const error = await catchError(() => decodeAll(new Uint8Array(), { encoding: 'klingon' }));
    expect(error).toBeInstanceOf(DslError);
    expect((error as DslError).code).toBe('DSL1002');
  });

  it('throws synchronously for invalid options', () => {
    const invalid: DecodeOptions[] = [
      { encoding: '' },
      { defaultEncoding: 'nope' },
      { defaultEncoding: 'utf-16le' },
      { decompress: 'zip' as 'auto' },
      { chunkSize: 0 },
      { chunkSize: 1.5 },
      { encoding: 1251 as unknown as string },
    ];
    const codes = invalid.map((options) => {
      try {
        decodeDsl(new Uint8Array(), options);
      } catch (error) {
        return (error as DslError).code;
      }
      return 'no error';
    });
    expect(codes).toEqual([
      'DSL1002',
      'DSL1002',
      'DSL0001',
      'DSL0001',
      'DSL0001',
      'DSL0001',
      'DSL0001',
    ]);
  });
});

describe('degenerate input', () => {
  it('decodes empty input', async () => {
    const result = await decodeAll(new Uint8Array());
    expect(result.text).toBe('');
    expect(result.chunks).toEqual([]);
    expect(result.info).toMatchObject({
      encoding: 'windows-1251',
      source: 'default',
      asciiOnly: true,
    });
  });

  it('decodes a single byte', async () => {
    expect((await decodeAll(new Uint8Array([0x23]))).text).toBe('#');
  });

  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
    it(`decodes a ${encoding} BOM alone to empty text`, async () => {
      const result = await decodeAll(encode('', encoding, true));
      expect(result.text).toBe('');
      expect(result.info).toMatchObject({ encoding, bom: true });
    });
  }

  it('decodes odd-length UTF-16 with a trailing U+FFFD and a warning', async () => {
    const bytes = encode('ab\nc', 'utf-16le', true);
    const result = await decodeAll(bytes.subarray(0, bytes.length - 1));
    expect(result.text).toBe('ab\n�');
    expect(result.codes).toEqual(['DSL1206']);
    expect(result.diagnostics[0]?.position).toEqual({ offset: 3, line: 2, column: 1 });
  });
});

describe('runtime support', () => {
  const RealTextDecoder = TextDecoder;
  /** Simulates a runtime without windows-1251 (e.g. a Node.js build without full ICU). */
  function withoutWindows1251() {
    vi.stubGlobal(
      'TextDecoder',
      class extends RealTextDecoder {
        constructor(label?: string, options?: TextDecoderOptions) {
          if (/1251/.test(String(label))) throw new RangeError('unsupported');
          super(label, options);
        }
      },
    );
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws DSL1003 for a forced encoding the runtime lacks', () => {
    withoutWindows1251();
    for (const encoding of ['windows-1251', 'Cyrillic']) {
      expect(() => decodeDsl(new Uint8Array(), { encoding })).toThrow(
        expect.objectContaining({ code: 'DSL1003' }),
      );
    }
    expect(() => decodeDsl(new Uint8Array(), { encoding: 'cp1251' })).toThrow(
      expect.objectContaining({ code: 'DSL1002' }),
    );
  });

  it('fails with DSL1003 when the implicit default encoding is needed but missing', async () => {
    withoutWindows1251();
    const error = await catchError(() => decodeAll(new Uint8Array([0x61, 0xe0, 0xe1])));
    expect(error).toBeInstanceOf(DslError);
    expect((error as DslError).code).toBe('DSL1003');
    // Input that does not need the default encoding is unaffected.
    expect((await decodeAll(encode(unicode, 'utf-16le', true))).text).toBe(unicode);
  });

  it('warns with DSL1203 for a directive the runtime cannot decode', async () => {
    withoutWindows1251();
    const text = dslText({ cards: [['é', 'x']], directive: '#SOURCE_CODE_PAGE "Cyrillic"' });
    const result = await decodeAll(encode(text, 'windows-1252'), {
      defaultEncoding: 'windows-1252',
    });
    expect(result.info).toMatchObject({ encoding: 'windows-1252', source: 'default' });
    expect(result.codes).toEqual(['DSL1203']);
    expect(result.text).toBe(text);
  });
});
