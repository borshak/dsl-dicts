import { describe, expect, it } from 'vitest';
import { articleOf, entry, outline, sense } from './helpers.js';

describe('zone-marked extractor: the sense tree', () => {
  it('nests numbering styles in the order I > 1. > 1) > а), whatever the [m] levels', async () => {
    const a = await articleOf(
      entry(
        '[b]I[/b]',
        '[m1][b]1.[/b] [p]n[/p][/m]',
        '[m1]1) [trn]a[/trn][/m]',
        '[m2]а) [trn]b[/trn][/m]',
        '[m2]б) [trn]c[/trn][/m]',
        '[m1]2) [trn]d[/trn][/m]',
        '[m1][b]2.[/b] [p]v[/p][/m]',
        '[m1]1) [trn]e[/trn][/m]',
        '[b]II[/b]',
        '[m1][trn]f[/trn][/m]',
      ),
    );
    expect(a.kind).toBe('zone-marked');
    expect(outline(a.senses)).toEqual([
      'I: ',
      '  1: ',
      '    1: a',
      '      а: b',
      '      б: c',
      '    2: d',
      '  2: ',
      '    1: e',
      'II: f',
    ]);
    expect(a.senses[0]?.senses[0]?.labels).toEqual([{ text: 'n' }]);
    expect(a.senses[0]?.senses[1]?.labels).toEqual([{ text: 'v' }]);
  });

  it('accepts roman numerals with a dot or a parenthesis, or in bold, and Latin letters', async () => {
    const a = await articleOf(
      entry('[m1]IV. [trn]a[/trn][/m]', '[m2]b) [trn]b[/trn][/m]', '[m1]V) [trn]c[/trn][/m]'),
    );
    expect(outline(a.senses)).toEqual(['IV: a', '  b: b', 'V: c']);
  });

  it('does not take ordinary text for numbering', async () => {
    const a = await articleOf(entry('[m1]I [trn]a[/trn][/m]', '[m1]1.5 [trn]b[/trn][/m]'));
    expect(a.senses).toEqual([
      sense({ translations: ['a'], notes: ['I'] }),
      sense({ translations: ['b'], notes: ['1.5'] }),
    ]);
  });

  it('opens a numbered sense on a line of its own, and fills it with the next translation', async () => {
    const a = await articleOf(
      entry(
        '[m1][b]1.[/b][/m]',
        '[m1][p]vt[/p] [trn]a[/trn][/m]',
        '[m1][b]2.[/b][/m]',
        '[m1]1)[/m]',
      ),
    );
    expect(a.senses).toEqual([
      sense({ number: '1', labels: [{ text: 'vt' }], translations: ['a'] }),
      sense({ number: '2', senses: [sense({ number: '1' })] }),
    ]);
  });

  it('makes unnumbered senses: beside the open one at its level, inside it when deeper', async () => {
    const a = await articleOf(
      entry(
        '[m1][trn]a[/trn][/m]',
        '[m1][trn]b[/trn][/m]',
        '[m2][trn]c[/trn][/m]',
        '[m1]1) [trn]d[/trn][/m]',
        '[m1][trn]e[/trn][/m]',
        '[m1]2) [trn]f[/trn][/m]',
      ),
    );
    expect(outline(a.senses)).toEqual(['-: a', '-: b', '  -: c', '1: d', '-: e', '2: f']);
  });

  it('attaches examples, comments and links to the open sense', async () => {
    const a = await articleOf(
      entry(
        '[m1]1) [trn]a[/trn][/m]',
        '[m2][*][ex][lang id=1033]x[/lang] — y[/ex][/*][/m]',
        '[m2][*][com]note[/com][/*][/m]',
        '[m2][*]- [ref]phrase[/ref][/*][/m]',
      ),
    );
    expect(a.senses).toEqual([
      sense({
        number: '1',
        translations: ['a'],
        examples: [
          {
            source: { text: 'x', language: 'English' },
            target: { text: 'y', language: 'Russian' },
          },
        ],
        comments: ['note'],
        references: [{ target: 'phrase' }],
      }),
    ]);
  });

  it('opens an unnumbered sense for examples with no sense open', async () => {
    const a = await articleOf(entry('[m1][*][ex][lang id=1033]x[/lang] — y[/ex][/*][/m]'));
    expect(a.senses).toHaveLength(1);
    expect(a.senses[0]).toMatchObject({ translations: [], examples: [{ source: { text: 'x' } }] });
    expect(a.senses[0]?.number).toBeUndefined();
  });

  it('gives labels, comments, links and notes before the first sense to the entry', async () => {
    const a = await articleOf(
      entry(
        '[p]сущ.[/p][c];[/c] [p]мн.[/p] [c]forms[/c]',
        '[m1][c][com]= [ref]other[/ref][/com][/c][/m]',
        '[m1][com](grammar)[/com][/m]',
        '[m1][trn]a[/trn][/m]',
      ),
    );
    expect(a).toMatchObject({
      labels: [{ text: 'сущ.' }, { text: 'мн.' }],
      references: [{ target: 'other', label: '=' }],
      comments: ['grammar'],
      notes: ['forms'],
      senses: [sense({ translations: ['a'] })],
    });
  });

  it('opens a group for a paragraph of labels after senses with content', async () => {
    const a = await articleOf(
      entry('[m1][p]n[/p][/m]', '[m1][trn]a[/trn][/m]', '[m1][p]v[/p][/m]', '[m1][trn]b[/trn][/m]'),
    );
    expect(a.labels).toEqual([{ text: 'n' }]);
    expect(a.senses).toEqual([
      sense({ translations: ['a'] }),
      sense({ labels: [{ text: 'v' }], translations: ['b'] }),
    ]);
  });

  it('starts a new section after a separator: idioms, phrasal verbs', async () => {
    const a = await articleOf(
      entry(
        '[m1]1) [trn]a[/trn][/m]',
        '[m1][*]•[/*][/m]',
        '[m1][*]- [ref]phrasal[/ref][/*][/m]',
        '[m1][*]••[/*][/m]',
        '[m1][*][ex][lang id=1033]idiom[/lang] — идиома[/ex][/*][/m]',
      ),
    );
    expect(a.references).toEqual([{ target: 'phrasal' }]);
    expect(a.senses).toHaveLength(2);
    expect(a.senses[0]).toEqual(sense({ number: '1', translations: ['a'] }));
    expect(a.senses[1]?.examples.map((e) => e.source.text)).toEqual(['idiom']);
  });

  it('keeps a group open across a separator of a deeper level', async () => {
    const a = await articleOf(
      entry(
        '[b]1.[/b] [p]n[/p]',
        '[m1]1) [trn]a[/trn][/m]',
        '[m1][*]••[/*][/m]',
        '[m1][*][ex][lang id=1033]idiom[/lang] — идиома[/ex][/*][/m]',
        '[b]2.[/b] [p]v[/p]',
        '[m1][trn]b[/trn][/m]',
      ),
    );
    expect(outline(a.senses)).toEqual(['1: ', '  1: a', '  -: ', '2: b']);
    expect(a.senses[0]?.senses[1]?.examples).toHaveLength(1);
  });

  it('labels the links after a heading such as Syn:', async () => {
    const a = await articleOf(
      entry(
        '[m1][trn]a[/trn][/m]',
        '[m2][*][b]Syn:[/b][/*][/m]',
        '[m2][*][ref]x[/ref], [ref]y[/ref][/*][/m]',
        '[m2][*][b]Ant:[/b][/*][/m]',
        '[m2][*][ref]z[/ref][/*][/m]',
        '[m2][*][b]See:[/b][/*][/m]',
        '[m2][*][com]nothing to label[/com][/*][/m]',
      ),
    );
    expect(a.senses[0]?.references).toEqual([
      { target: 'x', label: 'Syn' },
      { target: 'y', label: 'Syn' },
      { target: 'z', label: 'Ant' },
    ]);
    // A heading with no links after it is kept as a note.
    expect(a.senses[0]?.notes).toEqual(['See:']);
    expect(a.senses[0]?.comments).toEqual(['nothing to label']);
  });
});

describe('zone-marked extractor: translations, labels, comments, notes', () => {
  it('splits translations at semicolons outside brackets, unless asked not to', async () => {
    const text = entry('[m1][trn]a, b; c (d; e) [f; g]; h;[/trn][/m]');
    expect((await articleOf(text)).senses[0]?.translations).toEqual([
      'a, b',
      'c (d; e) [f; g]',
      'h',
    ]);
    expect((await articleOf(text, { splitTranslations: false })).senses[0]?.translations).toEqual([
      'a, b; c (d; e) [f; g]; h',
    ]);
  });

  it('takes labels and comments out of translations, crossed tags included', async () => {
    const a = await articleOf(
      entry(
        '[m1]1) [p][trn]мед.[/p] a[/trn][/m]',
        '[m1]2) [trn]b [com]([i]of c[/i])[/com]; [p]разг.[/p] d[/trn][/m]',
        '[m1]3) [i][trn][com](x)[/com][/i] [p]юр.[/p] e[/trn][/m]',
      ),
    );
    expect(a.senses).toEqual([
      sense({ number: '1', labels: [{ text: 'мед.' }], translations: ['a'] }),
      sense({
        number: '2',
        labels: [{ text: 'разг.' }],
        translations: ['b', 'd'],
        comments: ['of c'],
      }),
      sense({ number: '3', labels: [{ text: 'юр.' }], translations: ['e'], comments: ['x'] }),
    ]);
  });

  it('takes a comment that is all of a translation zone for the translation', async () => {
    const a = await articleOf(entry('[m1][i][trn][com](a description)[/com][/trn][/i][/m]'));
    expect(a.senses).toEqual([sense({ translations: ['a description'] })]);
  });

  it('removes only parentheses that enclose a whole comment', async () => {
    const a = await articleOf(
      entry('[m1][trn]a [com](x) y (z)[/com] [com]((nested))[/com] [com](open[/com][/trn][/m]'),
    );
    expect(a.senses[0]?.comments).toEqual(['(x) y (z)', '(nested)', '(open']);
  });

  it('keeps labels inside a comment or between texts as text', async () => {
    const a = await articleOf(
      entry('[m1][trn]a [com]([i]of [p]smb.[/p][/i])[/com][/trn][/m]', '[m1]x [p]y[/p] z[/m]'),
    );
    expect(a.senses[0]).toMatchObject({ labels: [], comments: ['of smb.'], notes: ['x y z'] });
  });

  it('keeps text outside zones as notes, labels in brackets included', async () => {
    const a = await articleOf(
      entry('[m1]1) [i][c](an[/c][/i] [p]A[/p][c])[/c] [trn]x[/trn][/m]', '[c]<-s, -e>[/c]'),
    );
    expect(a.senses).toEqual([
      sense({ number: '1', translations: ['x'], notes: ['(an A)', '<-s, -e>'] }),
    ]);
    expect(a.notes).toBeUndefined();
  });

  it('drops punctuation and numbering only', async () => {
    const a = await articleOf(entry('[m1]1) [trn]a[/trn] ; ,[/m]', '[m1]— / •[/m]'));
    expect(a).toMatchObject({ senses: [sense({ number: '1', translations: ['a'] })] });
    expect(a.notes).toBeUndefined();
  });

  it('reads transcriptions: [t], or brackets before the first sense or on a line of their own', async () => {
    const a = await articleOf(
      entry(
        '\\[[t]ˈkʌlə[/t]\\]',
        "\\['deɪ\\], \\[e'skɑː-\\]",
        '[m1][trn]a[/trn][/m]',
        '\\[ˈsecond\\]',
        '[m1][trn]b \\[c\\][/trn] [i]\\[not one\\][/i][/m]',
      ),
    );
    expect(a.transcriptions).toEqual(['ˈkʌlə', "'deɪ", "e'skɑː-", 'ˈsecond']);
    expect(a.senses[1]).toMatchObject({ translations: ['b [c]'], notes: ['[not one]'] });
  });

  it('leaves out secondary text with secondary: false', async () => {
    const text = entry(
      '[m1][trn]a[/trn][/m]',
      '[m2][*][ex][lang id=1033]x[/lang] — y[/ex][/*][/m]',
    );
    expect((await articleOf(text)).senses[0]?.examples).toHaveLength(1);
    expect((await articleOf(text, { secondary: false })).senses).toEqual([
      sense({ translations: ['a'] }),
    ]);
  });

  it("marks stresses with stress: 'combining'", async () => {
    const text = entry(
      "[m1][trn]пров[']и[/']нция[/trn][/m]",
      "[m2][ex][lang id=1033]x[/lang] — д[']о[/']м[/ex][/m]",
    );
    const plain = await articleOf(text);
    expect(plain.senses[0]?.translations).toEqual(['провинция']);
    const marked = await articleOf(text, { stress: 'combining' });
    expect(marked.senses[0]?.translations).toEqual(['прови\u0301нция']);
    expect(marked.senses[0]?.examples[0]?.target?.text).toBe('до\u0301м');
  });

  it('substitutes ~ with the headword', async () => {
    const a = await articleOf('colo(u)r\n\t[m1][trn]a ~[/trn] [com]^~ b[/com][/m]\n');
    expect(a.senses[0]).toMatchObject({ translations: ['a color'], comments: ['Color b'] });
    expect(a.headwords).toEqual([{ text: 'colo(u)r', variants: ['color', 'colour'] }]);
  });
});
