import { describe, expect, it } from 'vitest';
import {
  createCollectingSink,
  createDictionaryContext,
  normalizeLabel,
  parseAbbreviations,
  parseDsl,
  setupPlugin,
  toPlainText,
} from '../../src/index.js';
import { plainText } from '../../src/plugins/index.js';
import { catchError, dictzip, encode, gzip, split, streamOf } from '../decode/helpers.js';
import { collect, HEADER, thrown } from '../plugin/helpers.js';

const ABRV =
  '#NAME "Abbreviations"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "English"\n' +
  'adj.\n\tadjective\n' +
  'n\n\tnoun\n\tignored second line\n' +
  'v.\nvb.\n\t[m1]verb\n' +
  'sg  pl\n\tsingular  and\tplural\n' +
  'ü.\n\t\n\tüber\n';

describe('normalizeLabel', () => {
  it('trims and collapses every kind of whitespace, and keeps case', () => {
    expect(normalizeLabel('  adj.  comp.\t\n')).toBe('adj. comp.');
    expect(normalizeLabel('Adj.')).toBe('Adj.');
    expect(normalizeLabel('')).toBe('');
    expect(thrown(() => normalizeLabel(1 as never))).toMatchObject({ code: 'DSL0001' });
  });
});

describe('parseAbbreviations', () => {
  it('maps every headword of an entry to the first line of its body', async () => {
    const map = await parseAbbreviations(ABRV);
    expect([...map]).toEqual([
      ['adj.', 'adjective'],
      ['n', 'noun'],
      ['v.', 'verb'],
      ['vb.', 'verb'],
      ['sg pl', 'singular and plural'],
      ['ü.', 'über'],
    ]);
  });

  it('reads UTF-16LE with a BOM, UTF-8, gzip and dictzip alike', async () => {
    const expected = [...(await parseAbbreviations(ABRV))];
    const utf16 = encode(ABRV, 'utf-16le', true);
    for (const source of [
      utf16,
      split(utf16, 3),
      streamOf(split(utf16, 5)),
      new Blob([utf16.slice()]),
      encode(ABRV, 'utf-8', true),
      await gzip(utf16),
      await dictzip(encode(ABRV, 'utf-8'), { chunkLength: 64 }),
    ]) {
      expect([...(await parseAbbreviations(source))]).toEqual(expected);
    }
  });

  it('reads 8-bit input with the encoding options', async () => {
    const text =
      '#NAME "A"\n#INDEX_LANGUAGE "Russian"\n#CONTENTS_LANGUAGE "Russian"\nсущ.\n\tсуществительное\n';
    const bytes = encode(text, 'windows-1251');
    expect([...(await parseAbbreviations(bytes))]).toEqual([['сущ.', 'существительное']]);
    expect([...(await parseAbbreviations(bytes, { encoding: 'Cyrillic' }))]).toEqual([
      ['сущ.', 'существительное'],
    ]);
  });

  it('keeps the first of duplicate keys and reports DSL6001', async () => {
    const sink = createCollectingSink();
    const map = await parseAbbreviations(
      `${HEADER}a\n\tfirst\nb\n\tsecond\na\n\tthird\nb\nA\n\tother case\n`,
      { diagnostics: sink },
    );
    expect([...map]).toEqual([
      ['a', 'first'],
      ['b', 'second'],
      ['A', 'other case'],
    ]);
    expect(sink.diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL6001', 8],
      ['DSL6001', 10],
    ]);
  });

  it('compares keys after normalization', async () => {
    const sink = createCollectingSink();
    const map = await parseAbbreviations(`${HEADER}a  b\n\tx\na\\ b\n\ty\n`, {
      diagnostics: sink,
    });
    // An escaped space is a no-break space, which normalizes to a space.
    expect([...map]).toEqual([['a b', 'x']]);
    expect(sink.diagnostics.map((d) => d.code)).toEqual(['DSL6001']);
  });

  it('skips entries without text and reports DSL6002', async () => {
    const sink = createCollectingSink();
    const map = await parseAbbreviations(`${HEADER}a\nb\n\t\n\t[s]x.wav[/s]\nc\n\tok\nd\n`, {
      diagnostics: sink,
    });
    expect([...map]).toEqual([['c', 'ok']]);
    expect(sink.diagnostics.map((d) => d.code).filter((c) => c.startsWith('DSL6'))).toEqual([
      'DSL6002',
      'DSL6002',
    ]);
  });

  it('shows tags as plain text and passes the diagnostics of the pipeline', async () => {
    const sink = createCollectingSink();
    const map = await parseAbbreviations(`${HEADER}a\n\t[b]bold[/b] and [i]open\n`, {
      diagnostics: sink,
    });
    expect(map.get('a')).toBe('bold and open');
    expect(sink.diagnostics.map((d) => d.code)).toEqual(['DSL4202']);
  });

  it('returns an empty map for a file without entries', async () => {
    expect((await parseAbbreviations(HEADER)).size).toBe(0);
    expect((await parseAbbreviations('')).size).toBe(0);
  });

  it('rejects invalid arguments and honors strict', async () => {
    expect(await catchError(() => parseAbbreviations(1 as never))).toMatchObject({
      code: 'DSL0001',
    });
    expect(await catchError(() => parseAbbreviations('', null as never))).toMatchObject({
      code: 'DSL0001',
    });
  });
});

describe('broken input', () => {
  it('reports truncated gzip and keeps what was read; strict mode throws', async () => {
    const gz = await gzip(encode(ABRV, 'utf-8'));
    const truncated = gz.subarray(0, gz.length >> 1);
    const sink = createCollectingSink();
    const map = await parseAbbreviations(truncated, { diagnostics: sink });
    expect(sink.diagnostics.map((d) => d.code)).toContain('DSL1101');
    expect(map.size).toBeLessThan(6);
    expect(await catchError(() => parseAbbreviations(truncated, { strict: true }))).toMatchObject({
      code: 'DSL1101',
    });
  });
});

describe('abbreviations in plain text', () => {
  const DICT = 'word\n\t[p]adj.[/p] [p] sg \t pl [/p] [p]n[/p] [p]xyz[/p] text\n';

  it('expands [p] labels with a parsed map, after the same normalization', async () => {
    const map = await parseAbbreviations(ABRV);
    const expected = 'adjective singular and plural noun xyz text';
    const entries = await collect(parseDsl(HEADER + DICT, { abbreviations: map }).entries());
    expect(toPlainText(entries[0]?.body ?? [], { abbreviations: map })).toBe(expected);
    const out = await collect(
      parseDsl(HEADER + DICT, { abbreviations: map }).entries({
        plugin: plainText,
        options: { expandLabels: true },
      }),
    );
    expect(out[0]?.text).toBe(expected);
    const context = createDictionaryContext({ abbreviations: map });
    const [entry] = entries;
    expect(entry && setupPlugin(plainText, context, { expandLabels: true })(entry).text).toBe(
      expected,
    );
  });
});
