import { describe, expect, it } from 'vitest';
import { DslError } from '../../src/index.js';
import {
  catchError,
  concatBytes,
  decodeAll,
  dictzip,
  dslText,
  encode,
  gzip,
  normalized,
  split,
  streamOf,
} from './helpers.js';

const cards = Array.from({ length: 400 }, (_, i): [string, string] => [
  `слово${i}`,
  `[m1][trn]word ${i} café 𝄞[/trn][/m]`,
]);
const text = dslText({ cards, eol: '\r\n' });
const expected = normalized(text);
const utf16 = encode(text, 'utf-16le', true);

describe('gzip and dictzip', () => {
  it('decompresses dictzip (FEXTRA RA, FNAME)', async () => {
    const dz = await dictzip(utf16, { chunkLength: 16384, fileName: 'test.dsl' });
    expect([...dz.subarray(0, 4)]).toEqual([0x1f, 0x8b, 8, 4 | 8]);
    expect(String.fromCharCode(dz[12] as number, dz[13] as number)).toBe('RA');
    for (const size of [1, 7, 65536]) {
      const result = await decodeAll(split(dz, size), { chunkSize: size });
      expect(result.text).toBe(expected);
      expect(result.info).toMatchObject({ compression: 'gzip', encoding: 'utf-16le', bom: true });
      expect(result.codes).toEqual([]);
    }
  });

  it('decompresses dictzip of UTF-8 without FNAME', async () => {
    const dz = await dictzip(encode(text, 'utf-8'), { chunkLength: 4096 });
    const result = await decodeAll(streamOf(split(dz, 1000)));
    expect(result.text).toBe(expected);
    expect(result.info).toMatchObject({ compression: 'gzip', source: 'utf8-detect' });
  });

  it('decompresses plain gzip', async () => {
    const result = await decodeAll(await gzip(utf16));
    expect(result.text).toBe(expected);
    expect(result.info.compression).toBe('gzip');
  });

  it('reports uncompressed input', async () => {
    expect((await decodeAll(utf16)).info.compression).toBe('none');
  });

  it('does not decompress with decompress: none', async () => {
    const gz = await gzip(utf16);
    const result = await decodeAll(gz, { decompress: 'none', encoding: 'latin1' });
    expect(result.info.compression).toBe('none');
    expect(result.text.startsWith('\u001f‹')).toBe(true);
  });

  it('reports DSL1101 for non-gzip input with decompress: gzip', async () => {
    const result = await decodeAll(utf16, { decompress: 'gzip' });
    expect(result.text).toBe('');
    expect(result.codes).toEqual(['DSL1101']);
  });

  it('accepts gzip magic split across 1-byte chunks', async () => {
    const result = await decodeAll(split(await gzip(utf16), 1));
    expect(result.text).toBe(expected);
  });
});

describe('gzip failures', () => {
  async function expectFailure(bytes: Uint8Array) {
    const result = await decodeAll(bytes);
    expect(result.codes).toEqual(['DSL1101']);
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(expected.startsWith(result.text)).toBe(true);
    const error = await catchError(() => decodeAll(bytes, { strict: true }));
    expect(error).toBeInstanceOf(DslError);
    expect((error as DslError).code).toBe('DSL1101');
    expect((error as DslError).diagnostic?.code).toBe('DSL1101');
    return result;
  }

  it('reports truncated data', async () => {
    const gz = await gzip(utf16);
    await expectFailure(gz.subarray(0, gz.length - 10));
  });

  it('reports a bad CRC', async () => {
    const gz = await gzip(utf16);
    const bad = gz.slice();
    bad[bad.length - 8] = (bad[bad.length - 8] as number) ^ 0xff;
    await expectFailure(bad);
  });

  it('reports trailing junk', async () => {
    const gz = await gzip(utf16);
    await expectFailure(concatBytes([gz, new TextEncoder().encode('GARBAGE TRAILER\n')]));
  });

  it('reports corrupt data and keeps the text decoded before the failure', async () => {
    const big = encode(dslText({ cards: [...cards, ...cards, ...cards] }), 'utf-16le', true);
    const gz = await gzip(big);
    const bad = gz.slice();
    for (let i = Math.floor(bad.length * 0.8); i < bad.length - 8; i++) bad[i] = 0xaa;
    const result = await decodeAll(bad);
    expect(result.codes).toEqual(['DSL1101']);
    expect(result.diagnostics[0]?.byteOffset).toBeGreaterThan(0);
  });

  // Runtimes disagree here (some decode every member or ignore trailing zeros, others fail),
  // so only a consistent outcome is required: the full text, or DSL1101 after a prefix.
  for (const [name, build] of [
    [
      'several gzip members',
      async () =>
        concatBytes([await gzip(utf16.subarray(0, 40001)), await gzip(utf16.subarray(40001))]),
    ],
    ['trailing zeros', async () => concatBytes([await gzip(utf16), new Uint8Array(4)])],
  ] as const) {
    it(`handles ${name} consistently`, async () => {
      const result = await decodeAll(await build());
      if (result.codes.length === 0) {
        expect(result.text).toBe(expected);
      } else {
        expect(result.codes).toEqual(['DSL1101']);
        expect(expected.startsWith(result.text)).toBe(true);
      }
    });
  }
});
