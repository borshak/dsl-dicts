import { describe, expect, it } from 'vitest';
import { classifyBody, type ExtractionContext } from '../../src/article/index.js';
import { createDictionaryContext, parseBody, parseDsl } from '../../src/index.js';
import { articleOf, articlesOf, collect, entry } from './helpers.js';

async function kindOf(...lines: string[]): Promise<string> {
  return (await articleOf(entry(...lines))).kind;
}

describe('classifier', () => {
  it('finds zone-marked entries: a translation or example zone with text of its own', async () => {
    expect(await kindOf('[m1][trn]a[/trn]')).toBe('zone-marked');
    expect(await kindOf('[m1][*][ex][lang id=1033]a[/lang] — b[/ex][/*]')).toBe('zone-marked');
    expect(await kindOf('[trn1]a[/trn1]')).toBe('zone-marked');
    // A comment alone is a zone too.
    expect(await kindOf('[m1][com]a note[/com]')).toBe('zone-marked');
    expect(await kindOf('[m1][trn][/trn] plain')).toBe('zone-marked');
  });

  it('finds reference-only entries: links with labels, comments and short texts only', async () => {
    expect(await kindOf('см. <<other>>')).toBe('reference-only');
    expect(await kindOf('[m1][p]n[/p] [ref]other[/ref] 2)')).toBe('reference-only');
    // Links inside zones, with nothing else there but labels: still references.
    expect(
      await kindOf(
        '[m1][p][trn][com]уменьш.[/com][/trn][/p][trn][com] [ref]other[/ref] 2)[/com][/trn]',
      ),
    ).toBe('reference-only');
    // But a word of its own in a translation zone makes a translation.
    expect(await kindOf('[m1][trn]see [ref]other[/ref][/trn]')).toBe('zone-marked');
    expect(await kindOf('[m1][p]f[/p][com]; = [ref]other[/ref][/com]')).toBe('reference-only');
    expect(await kindOf('[m1][*][b]Syn:[/b][/*]', '[m1][*][ref]a[/ref], [ref]b[/ref][/*]')).toBe(
      'reference-only',
    );
    expect(await kindOf('[url]https://example.org[/url]')).toBe('reference-only');
  });

  it('finds media-only entries', async () => {
    expect(await kindOf('[s]a.wav[/s]')).toBe('media-only');
    expect(await kindOf('[t]ə[/t] [p]брит.[/p] [s]a.wav[/s] / [p]амер.[/p] [s]b.wav[/s]')).toBe(
      'media-only',
    );
    expect(await kindOf('[m1][video]clip.avi[/video][/m]')).toBe('media-only');
  });

  it('finds layout-only and plain entries', async () => {
    expect(await kindOf('[m1]1. first[/m]', '[m1]2. second[/m]')).toBe('layout-only');
    expect(await kindOf('just text', 'second line')).toBe('plain');
    expect(await kindOf('[b]bold[/b] and [i]italic[/i]')).toBe('plain');
    // Links with more text around them are not reference-only.
    expect(await kindOf('a long explanation of the word, see <<other>>')).toBe('plain');
    expect(await kindOf('[m1]a long explanation of the word, see <<other>>[/m]')).toBe(
      'layout-only',
    );
  });

  it('classifies an empty body as plain', async () => {
    const [first] = await articlesOf('w\n');
    expect(first).toMatchObject({ kind: 'plain', senses: [] });
  });

  it('does not look into sub-entries, which are classified on their own', async () => {
    const a = await articleOf(entry('[m1]text[/m]', '@ ~ x', '[m1][trn]y[/trn]', '@'));
    expect(a.kind).toBe('layout-only');
    expect(a.subentries.map((s) => s.kind)).toEqual(['zone-marked']);
  });

  it('can be called on its own', async () => {
    const dict = parseDsl('#NAME "t"\nw\n\t[m1][trn]x[/trn]\n', { body: 'raw' });
    const [raw] = await collect(dict.entries());
    const context: ExtractionContext = {
      dictionary: createDictionaryContext({ header: await dict.header }),
      options: { labels: 'expand', stress: 'none', secondary: true, splitTranslations: true },
      headwords: raw?.headwords ?? [],
      tilde: 'w',
    };
    expect(classifyBody(parseBody(raw as never, { positions: false }), context)).toBe(
      'zone-marked',
    );
    expect(classifyBody([], context)).toBe('plain');
  });
});
