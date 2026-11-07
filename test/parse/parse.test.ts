import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type BodyLine,
  createCollectingSink,
  type DslEntry,
  type DslError,
  type MarkupNode,
  parseBody,
  parseDsl,
  parseHeadwords,
  type RawEntry,
  segmentDsl,
} from '../../src/index.js';
import { catchError, encode, gzip } from '../decode/helpers.js';
import { markupText } from '../markup/arbitraries.js';
import { show } from '../markup/helpers.js';
import { HEADER } from '../segment/helpers.js';

const TEXT =
  `${HEADER}(пре)вращать(ся)\n{[']}a{[/']}b\n\t[m1][trn]turn[/trn][/m]\n` +
  `colo(u)r\n\t[m1]x[/m]\n\t@ ^~ code\n\t[m1]y[/m]\n\t@\n`;

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('parseDsl', () => {
  it('parses headwords and bodies', async () => {
    const dict = parseDsl(TEXT, { positions: false });
    const header = await dict.header;
    expect(header.name).toBe('Test');
    expect(header.indexLanguageInfo?.iso639_1).toBe('en');
    const entries = await collect(dict.entries());
    expect(entries.map((e) => e.headwords.map((h) => h.variants))).toEqual([
      [['вращать', 'вращаться', 'превращать', 'превращаться'], ['ab']],
      [['color', 'colour']],
    ]);
    expect(show(entries[0]?.body ?? [])).toBe('m{level=1}(trn("turn"))');
    expect(show(entries[1]?.body ?? [])).toBe('m{level=1}("x") @{Color code}(m{level=1}("y"))');
    expect(entries[1]).toMatchObject({
      position: { line: 7, column: 1 },
      end: { line: 11, column: 3 },
    });
    expect(dict.diagnostics).toEqual([]);
  });

  it('gives the same entries as segmentDsl, parseHeadwords and parseBody', async () => {
    const text = `${TEXT}a(b\n~\n\t[b]x\n\t@ ~ y\n\tz\n`;
    const reference = (await collect(segmentDsl(text).entries())).map((e: RawEntry): DslEntry => {
      const sink = createCollectingSink();
      const entry = {
        headwords: parseHeadwords(e, { diagnostics: sink }),
        body: parseBody(e, { diagnostics: sink }),
        position: e.position,
        end: e.end,
      };
      return sink.diagnostics.length > 0 ? { ...entry, diagnostics: sink.diagnostics } : entry;
    });
    expect(reference[2]?.diagnostics?.map((d) => d.code)).toEqual(['DSL3003', 'DSL4202']);
    expect(await collect(parseDsl(text).entries())).toEqual(reference);
  });

  it('keeps raw bodies for lazy parsing', async () => {
    const dict = parseDsl(TEXT, { body: 'raw' });
    const entries = await collect(dict.entries());
    expectTypeOf(entries[0]?.body).toEqualTypeOf<BodyLine[] | undefined>();
    expect(entries[1]?.body.map((l) => l.kind)).toEqual([
      'text',
      'subentry-start',
      'text',
      'subentry-end',
    ]);
    const parsed = await collect(parseDsl(TEXT).entries());
    expect(entries.map((e) => parseBody(e))).toEqual(parsed.map((e) => e.body));
  });

  it('types entries by body mode', () => {
    expectTypeOf(parseDsl(TEXT).entries()).toEqualTypeOf<AsyncIterable<DslEntry>>();
    expectTypeOf(parseDsl(TEXT, { body: 'ast' }).entries()).toEqualTypeOf<
      AsyncIterable<DslEntry<MarkupNode[]>>
    >();
    expectTypeOf(parseDsl(TEXT, { body: 'raw' }).batches()).toEqualTypeOf<
      AsyncIterable<DslEntry<BodyLine[]>[]>
    >();
  });

  it('keeps file diagnostics on the result and entry diagnostics on entries', async () => {
    const sink = createCollectingSink();
    const text = `#NAME "x"\n#INDEX_LANGUAGE "english"\n#CONTENTS_LANGUAGE "Russian"\na(b\n\t[b]x\n\n\ty\nc\n\tz\n`;
    const dict = parseDsl(encode(text, 'utf-8', true), { diagnostics: sink });
    const entries = await collect(dict.entries());
    expect(dict.diagnostics.map((d) => d.code)).toEqual(['DSL2007', 'DSL2203']);
    expect(entries.map((e) => e.diagnostics?.map((d) => d.code))).toEqual([
      ['DSL3003', 'DSL4202'],
      undefined,
    ]);
    // The sink receives all of them, as they are found.
    expect(sink.diagnostics.map((d) => d.code)).toEqual([
      'DSL2007',
      'DSL2203',
      'DSL3003',
      'DSL4202',
    ]);
  });

  it('keeps only headword diagnostics on raw entries', async () => {
    const [entry] = await collect(parseDsl(`${HEADER}a(b\n\t[b]x\n`, { body: 'raw' }).entries());
    expect(entry?.diagnostics?.map((d) => d.code)).toEqual(['DSL3003']);
  });

  it('reads gzip input in batches', async () => {
    const dict = parseDsl(await gzip(encode(TEXT, 'utf-16le', true)), { chunkSize: 16 });
    const batches = await collect(dict.batches());
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length > 0)).toBe(true);
    expect(batches.flat().map((e) => e.headwords[0]?.text)).toEqual([
      '(пре)вращать(ся)',
      'colo(u)r',
    ]);
    expect((await dict.info).compression).toBe('gzip');
  });

  it('leaves positions out of headwords and nodes on request, not out of entries', async () => {
    const [entry] = await collect(parseDsl(TEXT, { positions: false }).entries());
    expect(entry?.headwords[0]?.position).toBeUndefined();
    expect(entry?.body[0]?.position).toBeUndefined();
    expect(entry?.position).toEqual({ offset: 68, line: 4, column: 1 });
  });

  it('can read the entries only once', () => {
    const dict = parseDsl(TEXT);
    dict.batches();
    expect(() => dict.entries()).toThrow(expect.objectContaining({ code: 'DSL0002' }));
    expect(() => dict.batches()).toThrow(expect.objectContaining({ code: 'DSL0002' }));
  });

  it('stops on the first error in strict mode', async () => {
    const dict = parseDsl(`${HEADER}a(b\n\tx {{ open\n`, { strict: true });
    const error = (await catchError(() => collect(dict.entries()))) as DslError;
    expect(error.code).toBe('DSL2101');
  });

  it('passes warnings of every layer in strict mode', async () => {
    const dict = parseDsl(`${HEADER}a(b\n\t[b]x\n`, { strict: true });
    const [entry] = await collect(dict.entries());
    expect(entry?.diagnostics?.map((d) => d.code)).toEqual(['DSL3003', 'DSL4202']);
  });

  it('stops reading when the iteration is left early', async () => {
    let pulled = 0;
    const source = (async function* () {
      for (let i = 0; i < 1000; i++) {
        pulled++;
        yield encode(`${i === 0 ? HEADER : ''}w${i}\n\tx\n`, 'utf-8');
      }
    })();
    const dict = parseDsl(source, { chunkSize: 64 });
    let count = 0;
    for await (const _ of dict.entries()) if (++count === 3) break;
    expect(pulled).toBeLessThan(1000);
    const after = parseDsl(TEXT);
    const iterator = after.batches()[Symbol.asyncIterator]();
    await iterator.return?.();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('validates arguments synchronously', () => {
    for (const options of [null, { body: 'json' }, { positions: 'no' }]) {
      expect(() => parseDsl(TEXT, options as never)).toThrow(
        expect.objectContaining({ code: 'DSL0001' }),
      );
    }
    expect(() => parseDsl(42 as never)).toThrow(expect.objectContaining({ code: 'DSL0001' }));
  });

  it('gives fresh entries that do not depend on chunking', async () => {
    const body = fc
      .array(
        markupText.map((t) => t.replace(/\n/g, ' ')),
        { minLength: 1, maxLength: 4 },
      )
      .map((lines) => lines.map((l) => `\t${l || 'x'}\n`).join(''));
    const headword = markupText.map((t) => t.replace(/[\n\t ]/g, '').replace(/^[#@]/, 'w') || 'w');
    await fc.assert(
      fc.asyncProperty(headword, body, fc.integer({ min: 1, max: 9 }), async (hw, lines, size) => {
        const text = `${HEADER}${hw}\n${lines}`;
        const reference = await collect(parseDsl(text).entries());
        expect(await collect(parseDsl(text, { chunkSize: size }).entries())).toEqual(reference);
      }),
      { numRuns: 100 },
    );
  });
});
