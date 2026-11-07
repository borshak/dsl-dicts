import { describe, expect, it } from 'vitest';
import type { Example } from '../../src/article/index.js';
import { articleOf, entry } from './helpers.js';

/** The examples of a dictionary entry whose body is one translation and these lines. */
async function examplesOf(...lines: string[]): Promise<Example[]> {
  const a = await articleOf(entry('[m1][trn]t[/trn][/m]', ...lines.map((l) => `[m2]${l}[/m]`)));
  return a.senses[0]?.examples ?? [];
}

const EN = 'English';
const RU = 'Russian';

describe('examples', () => {
  it('split at a dash after the [lang] part: em dash, en dash, spaced hyphen', async () => {
    expect(
      await examplesOf(
        '[*][ex][lang id=1033]a b[/lang] — в г[/ex][/*]',
        '[ex][lang id=1033]a[/lang] – б[/ex]',
        '[ex][lang id=1033]a[/lang] - б-в[/ex]',
        '[ex][lang id=1033]a[/lang]—б[/ex]',
      ),
    ).toEqual([
      { source: { text: 'a b', language: EN }, target: { text: 'в г', language: RU } },
      { source: { text: 'a', language: EN }, target: { text: 'б', language: RU } },
      { source: { text: 'a', language: EN }, target: { text: 'б-в', language: RU } },
      { source: { text: 'a', language: EN }, target: { text: 'б', language: RU } },
    ]);
  });

  it('keep ≈ (an approximate equivalent) in the target, also when it is inside [lang]', async () => {
    expect(
      await examplesOf(
        '[ex][lang id=1033]a[/lang] ≈ б[/ex]',
        '[ex][lang id=1033]a [p]посл.[/p] ≈≈ б[/lang][/ex]',
      ),
    ).toEqual([
      { source: { text: 'a', language: EN }, target: { text: '≈ б', language: RU } },
      {
        source: { text: 'a', language: EN },
        target: { text: '≈≈ б', language: RU },
        labels: [{ text: 'посл.' }],
      },
    ]);
  });

  it('take labels out before the dash, just after it, or at the start', async () => {
    const [before, after, start, inside] = await examplesOf(
      '[ex][lang id=1033]Money makes money.[/lang] [p]посл.[/p] — Деньги к деньгам.[/ex]',
      '[ex][lang id=1033]a[/lang] — [p]разг.[/p] б[/ex]',
      '[ex][p]шутл.[/p] [lang id=1033]a[/lang] — б[/ex]',
      '[ex][lang id=1033]a[/lang] — б [p]x[/p] в[/ex]',
    );
    // dsl-dicts 1.x left ' посл. — Деньги к деньгам.' in the target.
    expect(before).toEqual({
      source: { text: 'Money makes money.', language: EN },
      target: { text: 'Деньги к деньгам.', language: RU },
      labels: [{ text: 'посл.' }],
    });
    expect(after?.labels).toEqual([{ text: 'разг.' }]);
    expect(after?.target?.text).toBe('б');
    expect(start?.labels).toEqual([{ text: 'шутл.' }]);
    expect(start?.source.text).toBe('a');
    // Elsewhere a label is part of the text.
    expect(inside).toEqual({
      source: { text: 'a', language: EN },
      target: { text: 'б x в', language: RU },
    });
  });

  it('keep dashes inside the source language, and comments and links as text', async () => {
    expect(
      await examplesOf(
        '[ex][lang id=1033]well — known[/lang] — б[/ex]',
        '[ex][lang id=1033]a[/lang] — б [i][com](в)[/com][/ex][/i]',
        '[ex][lang id=1033]see [ref]x[/ref][/lang] — <<y>>[/ex]',
      ),
    ).toEqual([
      { source: { text: 'well — known', language: EN }, target: { text: 'б', language: RU } },
      { source: { text: 'a', language: EN }, target: { text: 'б (в)', language: RU } },
      { source: { text: 'see x', language: EN }, target: { text: 'y', language: RU } },
    ]);
  });

  it('join a source split by crossing tags', async () => {
    const [crossed, split] = await examplesOf(
      '[ex][lang id=1031]über etw. [i]([/lang][/i][p]A[/p][i][lang id=1031])[/i] stellen[/lang] — б[/ex]',
      '[p][*][ex][lang id=1033]part one[/lang][/ex][/*][/p][*][ex][lang id=1033] part two[/lang] — б[/ex][/*]',
    );
    expect(crossed).toEqual({
      source: { text: 'über etw. (A) stellen', language: 'German' },
      target: { text: 'б', language: RU },
    });
    expect(split).toEqual({
      source: { text: 'part one part two', language: EN },
      target: { text: 'б', language: RU },
    });
  });

  it('tell apart examples of one paragraph', async () => {
    const list = await examplesOf(
      '[ex][lang id=1033]a[/lang] — б[/ex] [ex][lang id=1033]c[/lang] — д[/ex]',
    );
    expect(list.map((e) => [e.source.text, e.target?.text])).toEqual([
      ['a', 'б'],
      ['c', 'д'],
    ]);
  });

  it('may have no target', async () => {
    expect(await examplesOf('[ex][lang id=1033]only the source[/lang][/ex]')).toEqual([
      { source: { text: 'only the source', language: EN } },
    ]);
  });

  it('resolve languages: [lang id], [lang name], legacy ids, the header', async () => {
    expect(
      await examplesOf(
        '[ex][lang name="German"]a[/lang] — б[/ex]',
        '[ex][lang id=3]a[/lang] — б[/ex]',
        '[ex][lang name="english"]a[/lang] — б[/ex]',
        '[ex]no lang — б[/ex]',
        '[ex][lang id=99999]unknown[/lang] — б[/ex]',
        // In the contents language: the target is in the index language.
        '[ex][lang id=1049]ру[/lang] — en[/ex]',
      ),
    ).toEqual([
      { source: { text: 'a', language: 'German' }, target: { text: 'б', language: RU } },
      { source: { text: 'a', language: 'German' }, target: { text: 'б', language: RU } },
      { source: { text: 'a', language: EN }, target: { text: 'б', language: RU } },
      { source: { text: 'no lang', language: EN }, target: { text: 'б', language: RU } },
      { source: { text: 'unknown', language: EN }, target: { text: 'б', language: RU } },
      { source: { text: 'ру', language: RU }, target: { text: 'en', language: EN } },
    ]);
  });

  it('have no languages when the header has none', async () => {
    const a = await articleOf(entry('[m1][ex]a — б[/ex][/m]'), undefined, {
      header: '#NAME "x"\n',
    });
    expect(a.senses[0]?.examples).toEqual([{ source: { text: 'a' }, target: { text: 'б' } }]);
  });
});
