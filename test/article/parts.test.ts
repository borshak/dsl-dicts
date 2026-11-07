import { describe, expect, it } from 'vitest';
import { articleOf, entry, outline, sense } from './helpers.js';

describe('labels', () => {
  const abbreviations = new Map([
    ['n', 'noun'],
    ['разг.', 'разговорное'],
    ['adj. comp.', 'comparative'],
  ]);

  it('get their expansion from the abbreviations, keys normalized', async () => {
    const a = await articleOf(
      entry('[p]n[/p] [p]x[/p]', '[m1][p]adj.  comp.[/p] [trn][p]разг.[/p] a[/trn][/m]'),
      undefined,
      { abbreviations },
    );
    expect(a.labels).toEqual([{ text: 'n', expansion: 'noun' }, { text: 'x' }]);
    expect(a.senses[0]?.labels).toEqual([
      { text: 'adj. comp.', expansion: 'comparative' },
      { text: 'разг.', expansion: 'разговорное' },
    ]);
  });

  it('are left out when blank', async () => {
    const a = await articleOf(
      entry('[p] [/p] [s]a.wav[/s]', '[m1][p][/p] [trn][p] [/p]a[/trn][/m]'),
    );
    expect(a.labels).toEqual([]);
    expect(a.media).toEqual([{ file: 'a.wav', type: 'sound' }]);
    expect(a.senses).toEqual([sense({ translations: ['a'] })]);
  });

  it('keep their text only with expandLabels: false, or without abbreviations', async () => {
    const text = entry('[p]n[/p]', '[m1][trn]a[/trn][/m]');
    expect((await articleOf(text, { expandLabels: false }, { abbreviations })).labels).toEqual([
      { text: 'n' },
    ]);
    expect((await articleOf(text)).labels).toEqual([{ text: 'n' }]);
  });

  it('are left out with labels: false, still recognized', async () => {
    const text = entry(
      '[p]n[/p] [p]брит.[/p] [s]a.wav[/s]',
      '[m1]1) [p]разг.[/p] [trn]a[/trn][/m]',
      '[m2][ex][lang id=1033]x[/lang] — [p]посл.[/p] y[/ex][/m]',
      '@ ~ sub',
      '[m1][p]n[/p] [trn]b[/trn][/m]',
      '@',
    );
    const full = await articleOf(text, undefined, { abbreviations });
    const bare = await articleOf(text, { labels: false }, { abbreviations });
    expect(full.labels.length).toBeGreaterThan(0);
    expect(bare.labels).toEqual([]);
    expect(bare.media).toEqual([{ file: 'a.wav', type: 'sound' }]);
    expect(bare.senses[0]?.labels).toEqual([]);
    expect(bare.senses[0]?.translations).toEqual(full.senses[0]?.translations);
    expect(bare.senses[0]?.examples).toEqual([
      { source: { text: 'x', language: 'English' }, target: { text: 'y', language: 'Russian' } },
    ]);
    expect(bare.subentries[0]?.senses[0]?.labels).toEqual([]);
    expect(bare.subentries[0]?.senses[0]?.translations).toEqual(['b']);
    // Nothing but the labels differs.
    const strip = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value), (key, v) =>
        key === 'labels' && Array.isArray(v) ? undefined : key === 'label' ? undefined : v,
      );
    expect(strip(bare)).toEqual(strip(full));
  });

  it('of examples and media are expanded too', async () => {
    const a = await articleOf(
      entry('[p]n[/p] [s]a.wav[/s]', '[m1][ex][lang id=1033]a[/lang] — [p]разг.[/p] б[/ex][/m]'),
      undefined,
      { abbreviations },
    );
    expect(a.media).toEqual([
      { file: 'a.wav', type: 'sound', label: { text: 'n', expansion: 'noun' } },
    ]);
    expect(a.senses[0]?.examples[0]?.labels).toEqual([{ text: 'разг.', expansion: 'разговорное' }]);
  });
});

describe('references', () => {
  it('come from <<>>, [ref] and [url], with their attributes', async () => {
    const a = await articleOf(
      entry(
        '[m1][trn]a[/trn][/m]',
        '[m2]<<one>>, [ref]two[/ref], [ref dict="Other Dict"]three[/ref][/m]',
        '[m2][ref target="four"]shown[/ref] [url]https://example.org[/url][/m]',
      ),
    );
    expect(a.senses[0]?.references).toEqual([
      { target: 'one' },
      { target: 'two' },
      { target: 'three', dictionary: 'Other Dict' },
      { target: 'four', text: 'shown' },
      { target: 'https://example.org', external: true },
    ]);
  });

  it('are labelled by a short text or a symbol just before them, and numbered by one after', async () => {
    const a = await articleOf(
      entry(
        '[m1]см. <<one>>[/m]',
        '[m1][c][com]= [ref]two[/ref] 2)[/com][/c][/m]',
        '[m1][ref]three[/ref] I 3), [ref]four[/ref][/m]',
        '[m1]a much longer text that is no label <<five>>[/m]',
      ),
    );
    expect(a.references).toEqual([
      { target: 'one', label: 'см.' },
      { target: 'two', label: '=', sense: '2)' },
      { target: 'three', sense: 'I 3)' },
      { target: 'four' },
      { target: 'five' },
    ]);
    expect(a.notes).toEqual(['a much longer text that is no label']);
  });

  it('substitute ~ and skip empty links', async () => {
    const a = await articleOf('cat\n\t[m1]<<~ flap>> <<>> [ref] [/ref][/m]\n');
    expect(a.references).toEqual([{ target: 'cat flap' }]);
  });
});

describe('media', () => {
  it('are typed by extension, wherever they are', async () => {
    const a = await articleOf(
      entry(
        '[s]a.WAV[/s] [s]b.mp3[/s] [s]c.jpg[/s] [s]d.avi[/s] [s]e.xyz[/s] [video]f.xyz[/video]',
        '[m1][trn]a [s]g.png[/s][/trn][/m]',
      ),
    );
    expect(a.media).toEqual([
      { file: 'a.WAV', type: 'sound' },
      { file: 'b.mp3', type: 'sound' },
      { file: 'c.jpg', type: 'image' },
      { file: 'd.avi', type: 'video' },
      { file: 'e.xyz', type: 'other' },
      { file: 'f.xyz', type: 'video' },
      { file: 'g.png', type: 'image' },
    ]);
    expect(a.senses).toEqual([sense({ translations: ['a'] })]);
  });

  it('take the label just before them', async () => {
    const a = await articleOf(
      entry('\\[ˈæsk\\][p][i]брит.[/i][/p] [s]a.wav[/s] / [p][i]амер.[/i][/p] [s]b.wav[/s]'),
    );
    expect(a).toMatchObject({
      kind: 'media-only',
      transcriptions: ['ˈæsk'],
      labels: [],
      media: [
        { file: 'a.wav', type: 'sound', label: { text: 'брит.' } },
        { file: 'b.wav', type: 'sound', label: { text: 'амер.' } },
      ],
    });
  });
});

describe('the other extractors', () => {
  it('layout-only: text outside zones is a translation, or an example', async () => {
    const a = await articleOf(
      entry(
        '[m1]1. a; b[/m]',
        '[m2][lang id=1033]phrase[/lang] — фраза[/m]',
        '[m2]other phrase — другая фраза[/m]',
        '[m1]2. [p]разг.[/p] c[/m]',
      ),
    );
    expect(a.kind).toBe('layout-only');
    expect(a.senses).toEqual([
      sense({
        number: '1',
        translations: ['a', 'b'],
        examples: [
          {
            source: { text: 'phrase', language: 'English' },
            target: { text: 'фраза', language: 'Russian' },
          },
          {
            source: { text: 'other phrase', language: 'English' },
            target: { text: 'другая фраза', language: 'Russian' },
          },
        ],
      }),
      sense({ number: '2', labels: [{ text: 'разг.' }], translations: ['c'] }),
    ]);
  });

  it('plain: one sense with the lines as translations, as in dsl-dicts 1.x', async () => {
    const a = await articleOf(entry('first; second', '1) not numbered here', '[p]n[/p] third'));
    expect(a.kind).toBe('plain');
    expect(a.senses).toEqual([
      sense({
        labels: [{ text: 'n' }],
        translations: ['first', 'second', '1) not numbered here', 'third'],
      }),
    ]);
  });

  it('plain: no sense without text', async () => {
    const a = await articleOf(entry('[p]n[/p] [com](c)[/com]'));
    expect(a).toMatchObject({ kind: 'zone-marked', labels: [{ text: 'n' }], comments: ['c'] });
    expect((await articleOf(entry('[p]n[/p]'), { kind: 'plain' })).senses).toEqual([]);
  });

  it('reference-only: links of the entry, or of its numbered homonyms', async () => {
    const flat = await articleOf(entry('[p]n[/p] см. <<a>>'));
    expect(flat).toMatchObject({
      kind: 'reference-only',
      labels: [{ text: 'n' }],
      references: [{ target: 'a', label: 'см.' }],
      senses: [],
    });
    const numbered = await articleOf(entry('[b]I[/b] [p]v[/p] см. <<a>>', '[b]II[/b] см. <<b>>'));
    expect(numbered.kind).toBe('reference-only');
    expect(outline(numbered.senses)).toEqual(['I: ', 'II: ']);
    expect(numbered.senses.map((s) => s.references)).toEqual([
      [{ target: 'a', label: 'см.' }],
      [{ target: 'b', label: 'см.' }],
    ]);
  });
});
