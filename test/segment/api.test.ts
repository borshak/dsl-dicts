import { describe, expect, it } from 'vitest';
import { createCollectingSink, type DslError, type RawEntry, segmentDsl } from '../../src/index.js';
import { catchError, encode, gzip } from '../decode/helpers.js';
import { HEADER, headwords, segmentAsync } from './helpers.js';

const TEXT = `${HEADER}a\n\tx\nb\n\ty\nc\n\tz\n`;

describe('segmentDsl', () => {
  it('resolves the header before the entries are read', async () => {
    const result = segmentDsl(encode(TEXT, 'utf-16le', true), { chunkSize: 4 });
    const header = await result.header;
    expect(header.name).toBe('Test');
    expect((await result.info).encoding).toBe('utf-16le');
    const entries: RawEntry[] = [];
    for await (const entry of result.entries()) entries.push(entry);
    expect(headwords(entries)).toEqual([['a'], ['b'], ['c']]);
  });

  it('reads gzip input and yields batches', async () => {
    const result = segmentDsl(await gzip(encode(TEXT, 'utf-8', true)), { chunkSize: 16 });
    const batches: RawEntry[][] = [];
    for await (const batch of result.batches()) batches.push(batch);
    expect(batches.every((batch) => batch.length > 0)).toBe(true);
    expect(headwords(batches.flat())).toEqual([['a'], ['b'], ['c']]);
    expect((await result.info).compression).toBe('gzip');
  });

  it('collects decoding and segmentation diagnostics in order and forwards them', async () => {
    const sink = createCollectingSink();
    const text = `${HEADER}a\n\tx\n\n\ty\n`;
    const bytes = encode(text, 'utf-8', true);
    const result = segmentDsl(bytes, { encoding: 'windows-1252', diagnostics: sink });
    for await (const _ of result.entries());
    // The BOM, decoded as text, turns the first directive into a headword.
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'DSL1201',
      'DSL2001',
      'DSL2001',
      'DSL2001',
      'DSL2006',
      'DSL2006',
      'DSL2203',
    ]);
    expect(sink.diagnostics).toEqual(result.diagnostics);
  });

  it('can read the entries only once', () => {
    const result = segmentDsl(TEXT);
    result.entries();
    expect(() => result.batches()).toThrow(expect.objectContaining({ code: 'DSL0002' }));
    expect(() => result.entries()).toThrow(expect.objectContaining({ code: 'DSL0002' }));
  });

  it('stops on the first error in strict mode', async () => {
    const result = segmentDsl(`${HEADER}a\n\tx {{ open\n`, { strict: true });
    const error = (await catchError(async () => {
      for await (const _ of result.entries());
    })) as DslError;
    expect(error.code).toBe('DSL2101');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['DSL2101']);
  });

  it('passes warnings in strict mode', async () => {
    const result = segmentDsl(`${HEADER}a\n\n\tx\n`, { strict: true });
    for await (const _ of result.entries());
    expect(result.diagnostics.map((d) => d.code)).toEqual(['DSL2202']);
  });

  it('rejects the header and the entries when the source fails', async () => {
    const failing = (async function* () {
      yield encode('#NAME "x"\n', 'utf-8');
      throw new Error('boom');
    })();
    const result = segmentDsl(failing);
    const headerError = (await catchError(() => result.header)) as DslError;
    expect(headerError.code).toBe('DSL1001');
    const iterationError = (await catchError(async () => {
      for await (const _ of result.entries());
    })) as DslError;
    expect(iterationError).toBe(headerError);
  });

  it('rejects the header with DSL0003 when reading stops before it is complete', async () => {
    const result = segmentDsl(TEXT);
    const iterator = result.entries()[Symbol.asyncIterator]();
    await iterator.return?.();
    expect(((await catchError(() => result.header)) as DslError).code).toBe('DSL0003');
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('stops reading when the iteration is left early', async () => {
    let pulled = 0;
    const source = (async function* () {
      for (let i = 0; i < 1000; i++) {
        pulled++;
        yield encode(`${i === 0 ? HEADER : ''}w${i}\n\tx\n`, 'utf-8');
      }
    })();
    const result = segmentDsl(source, { chunkSize: 64 });
    let count = 0;
    for await (const _ of result.entries()) if (++count === 3) break;
    expect(count).toBe(3);
    expect(pulled).toBeLessThan(1000);
    expect((await result.header).name).toBe('Test');
  });

  it('keeps offsets aligned with decodeDsl when the text starts with a second BOM', async () => {
    const text = `\uFEFF\uFEFF${HEADER}a\n\tx\n`;
    const result = await segmentAsync(text);
    // decodeDsl removes the first BOM; the second one is text and starts a headword.
    expect(result.entries[0]?.position).toEqual({ offset: 0, line: 1, column: 1 });
    expect(result.entries[0]?.headwords[0]?.text).toBe('\uFEFF#NAME "Test"');
  });

  it('validates arguments synchronously', () => {
    expect(() => segmentDsl(TEXT, null as never)).toThrow(
      expect.objectContaining({ code: 'DSL0001' }),
    );
    expect(() => segmentDsl(42 as never)).toThrow(expect.objectContaining({ code: 'DSL0001' }));
  });
});
