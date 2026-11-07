import { describe, expect, it } from 'vitest';
import { createCollectingSink, DslError, decodeDsl } from '../../src/index.js';
import {
  asyncOf,
  catchError,
  decodeAll,
  dslText,
  encode,
  split,
  streamOf,
  UNICODE_CARDS,
} from './helpers.js';

const text = dslText({ cards: UNICODE_CARDS });
const bytes = encode(text, 'utf-16le', true);

describe('input types', () => {
  const sources: [string, () => unknown][] = [
    ['Uint8Array', () => bytes],
    ['Uint8Array view at an offset', () => new Uint8Array([1, 2, 3, ...bytes]).subarray(3)],
    ['DataView', () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)],
    ['ArrayBuffer', () => bytes.slice().buffer],
    ['Blob', () => new Blob([bytes.slice()])],
    ['ReadableStream', () => streamOf(split(bytes, 100))],
    ['AsyncIterable', () => asyncOf(split(bytes, 100))],
    ['Iterable', () => split(bytes, 100)],
    [
      'generator',
      () =>
        (function* () {
          yield* split(bytes, 3);
        })(),
    ],
  ];
  for (const [name, make] of sources) {
    it(`accepts ${name}`, async () => {
      const result = await decodeAll(make() as Uint8Array);
      expect(result.text).toBe(text);
      expect(result.info).toMatchObject({ encoding: 'utf-16le', source: 'bom' });
    });
  }

  it('accepts a string: strips a BOM and normalizes newlines', async () => {
    const result = await decodeAll(`﻿#SOURCE_CODE_PAGE "Latin"\r\nword\r\n\tx\r`);
    expect(result.text).toBe('#SOURCE_CODE_PAGE "Latin"\nword\n\tx\n');
    expect(result.info).toEqual({
      encoding: 'utf-16',
      source: 'string',
      bom: true,
      compression: 'none',
      asciiOnly: false,
      directive: 'Latin',
    });
    expect(result.codes).toEqual([]);
  });

  it('decodes an empty string', async () => {
    const result = await decodeAll('');
    expect(result.text).toBe('');
    expect(result.info).toMatchObject({ source: 'string', bom: false });
  });

  it('throws DSL0001 synchronously for an unsupported source', () => {
    for (const source of [42, null, undefined, {}, true]) {
      const error = (() => {
        try {
          decodeDsl(source as unknown as Uint8Array);
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(DslError);
      expect((error as DslError).code).toBe('DSL0001');
    }
  });

  it('fails with DSL0001 for a chunk that is not bytes', async () => {
    const error = await catchError(() => decodeAll([bytes, 'text' as unknown as Uint8Array]));
    expect((error as DslError).code).toBe('DSL0001');
  });
});

describe('errors and cancellation', () => {
  const failing = (where: 'start' | 'later') => {
    const cause = new Error('disk on fire');
    async function* source() {
      if (where === 'later') yield bytes.subarray(0, 10_000);
      throw cause;
    }
    return { cause, source };
  };

  for (const where of ['start', 'later'] as const) {
    it(`wraps a source error (${where}) as DSL1001 with the cause`, async () => {
      const { cause, source } = failing(where);
      const decoded = decodeDsl(source());
      const info = decoded.info;
      const error = await catchError(async () => {
        for await (const _ of decoded);
      });
      expect(error).toBeInstanceOf(DslError);
      expect((error as DslError).code).toBe('DSL1001');
      expect((error as DslError).cause).toBe(cause);
      if (where === 'start') await expect(info).rejects.toBe(error);
    });
  }

  it('wraps an erroring ReadableStream', async () => {
    const cause = new TypeError('network');
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(cause);
      },
    });
    const error = await catchError(() => decodeAll(stream));
    expect((error as DslError).code).toBe('DSL1001');
    expect((error as DslError).cause).toBe(cause);
  });

  it('wraps a source error inside gzip input', async () => {
    const cause = new Error('boom');
    async function* source() {
      yield new Uint8Array([0x1f, 0x8b, 8, 0]);
      throw cause;
    }
    const error = await catchError(() => decodeAll(source()));
    expect((error as DslError).code).toBe('DSL1001');
    expect((error as DslError).cause).toBe(cause);
  });

  it('cancels the source when iteration stops early', async () => {
    let cancelled = false;
    let index = 0;
    const chunks = split(bytes, 64);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunks[index++] ?? new Uint8Array(64));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of decodeDsl(stream, { chunkSize: 64 })) break;
    expect(cancelled).toBe(true);
  });

  it('closes an async iterable source when iteration stops early', async () => {
    let closed = false;
    async function* source() {
      try {
        for (;;) yield new Uint8Array(1000).fill(0x61);
      } finally {
        closed = true;
      }
    }
    for await (const _ of decodeDsl(source())) break;
    expect(closed).toBe(true);
  });

  it('rejects info with DSL0003 when stopped before the encoding is known', async () => {
    const ascii = new Uint8Array(200_000).fill(0x61);
    const decoded = decodeDsl(split(ascii, 1000), { chunkSize: 1000 });
    for await (const _ of decoded) break;
    const error = await catchError(() => decoded.info);
    expect((error as DslError).code).toBe('DSL0003');
  });

  it('can be iterated only once', async () => {
    const decoded = decodeDsl(bytes);
    for await (const _ of decoded);
    const error = await catchError(async () => {
      for await (const _ of decoded);
    });
    expect((error as DslError).code).toBe('DSL0002');
  });
});

describe('info', () => {
  it('can be awaited before iterating; the buffered text is still yielded', async () => {
    const ascii = `${'a'.repeat(100_000)}\nж\n`;
    const decoded = decodeDsl(encode(ascii, 'utf-8'), { chunkSize: 1000 });
    const info = await decoded.info;
    expect(info).toMatchObject({ encoding: 'utf-8', source: 'utf8-detect', asciiOnly: false });
    let out = '';
    for await (const chunk of decoded) out += chunk;
    expect(out).toBe(ascii);
  });

  it('resolves early, before the input is read to the end', async () => {
    let pulled = 0;
    const big = encode(dslText({ cards: Array(100).fill(UNICODE_CARDS).flat() }), 'utf-16le');
    const chunks = split(big, 1000);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulled++];
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const info = await decodeDsl(stream, { chunkSize: 1000 }).info;
    expect(info).toMatchObject({ encoding: 'utf-16le', source: 'heuristic' });
    expect(chunks.length).toBeGreaterThan(20);
    expect(pulled).toBeLessThan(10);
  });

  it('is the same object when awaited during and after iteration', async () => {
    const decoded = decodeDsl(bytes);
    const early = decoded.info;
    for await (const _ of decoded);
    expect(decoded.info).toBe(early);
    expect((await early).encoding).toBe('utf-16le');
  });
});

describe('diagnostics delivery', () => {
  const stale = encode(
    dslText({ cards: UNICODE_CARDS, directive: '#SOURCE_CODE_PAGE "Klingon"' }),
    'utf-8',
  );

  it('forwards diagnostics to the sink and collects them on the result', async () => {
    const sink = createCollectingSink();
    const decoded = decodeDsl(stale, { diagnostics: sink });
    for await (const _ of decoded);
    expect(sink.diagnostics.map((d) => d.code)).toEqual(['DSL1205']);
    expect(decoded.diagnostics).toEqual(sink.diagnostics);
  });

  it('does not throw for warnings in strict mode', async () => {
    const result = await decodeAll(stale, { strict: true });
    expect(result.codes).toEqual(['DSL1205']);
  });

  it('strict mode still forwards to the sink before throwing', async () => {
    const sink = createCollectingSink();
    const error = await catchError(() =>
      decodeAll(bytes, { strict: true, diagnostics: sink, decompress: 'gzip' }),
    );
    expect((error as DslError).code).toBe('DSL1101');
    expect(sink.diagnostics.map((d) => d.code)).toEqual(['DSL1101']);
  });
});
