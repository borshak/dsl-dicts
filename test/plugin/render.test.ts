import { describe, expect, it } from 'vitest';
import {
  hasZones,
  type MarkupNode,
  parseHeadword,
  parseMarkup,
  SEARCH_ZONES,
  toPlainText,
  zoneText,
} from '../../src/index.js';
import { deepFreeze, entryOf, thrown } from './helpers.js';

const NBSP = String.fromCharCode(0xa0);

/** Parses markup into a deeply frozen tree. */
function nodes(text: string): readonly MarkupNode[] {
  return deepFreeze(parseMarkup(text, { positions: false }));
}

function plain(text: string, options: Parameters<typeof toPlainText>[1] = {}): string {
  return toPlainText(nodes(text), options);
}

describe('toPlainText', () => {
  it('keeps text and drops tags', () => {
    expect(plain("[b]bold[/b] [i]it[/i] [c red]red[/c] [u]u[/u] x[sup]2[/sup] [']a[/']")).toBe(
      'bold it red u x2 a',
    );
    expect(plain('[lang id=1033]en[/lang] [t]ˈtɛst[/t] [foo]unknown[/foo]')).toBe(
      'en ˈtɛst unknown',
    );
  });

  it('substitutes ~ from the headwords, and ^~ with the case flipped', () => {
    const headwords = [parseHeadword('colo(u)r'), parseHeadword('hue')];
    expect(plain('a ~ b ^~', { headwords })).toBe('a color b Color');
    expect(plain('^~', { headwords: [parseHeadword('Éclair')] })).toBe('éclair');
    expect(plain('^~', { headwords: [parseHeadword('𝔄x')] })).toBe('𝔄x');
    expect(plain('~ ^~', { tilde: 'own', headwords })).toBe('own Own');
    expect(plain('~ ^~')).toBe('~ ^~');
    expect(plain('~', { headwords: [] })).toBe('~');
  });

  it('makes line breaks newlines and [m] paragraphs lines', () => {
    expect(plain('a\nb[br]c')).toBe('a\nb\nc');
    expect(plain('[m1]a[/m][m2]b\nc[m1]d')).toBe('a\nb\nc\nd');
    expect(plain('x[m1]a')).toBe('x\na');
  });

  it('indents paragraphs by level, continuation lines included', () => {
    expect(plain('[m0]a[m1]b\nc[m3]d[br]e', { indent: '  ' })).toBe(
      'a\n  b\n  c\n      d\n      e',
    );
    expect(plain('[m2]a[/m] b\nc', { indent: '\t' })).toBe('\t\ta b\nc');
  });

  it('collapses spaces and tabs, trims lines, drops empty lines, keeps U+00A0', () => {
    expect(plain(' a \t  b ')).toBe('a b');
    expect(plain('a\\ \\ b')).toBe(`a${NBSP}${NBSP}b`);
    expect(plain(`${NBSP}a${NBSP}`)).toBe(`${NBSP}a${NBSP}`);
    expect(plain('a[br][br] [br]b')).toBe('a\nb');
    expect(plain('[m1] [m2]')).toBe('');
    expect(plain('')).toBe('');
  });

  it('includes [*] unless secondary is false', () => {
    expect(plain('a [*]b[/*] c')).toBe('a b c');
    expect(plain('a [*]b[/*] c', { secondary: false })).toBe('a c');
  });

  it('leaves media out unless media is true', () => {
    const text = 'a [s]x.wav[/s] [video]y z.avi[/video] [s]p.jpg[preview]v[/preview][/s] b';
    expect(plain(text)).toBe('a b');
    expect(plain(text, { media: true })).toBe('a x.wav y z.avi p.jpgv b');
  });

  it('includes [!trs] unless unindexed is false', () => {
    expect(plain('[trn]a [!trs]b[/!trs][/trn]')).toBe('a b');
    expect(plain('[trn]a [!trs]b[/!trs][/trn]', { unindexed: false })).toBe('a');
  });

  it('keeps [p] labels, expands them from abbreviations, or drops them', () => {
    const abbreviations = new Map([
      ['adj.', 'adjective'],
      ['~ form', 'tilde form'],
    ]);
    expect(plain('[p]adj.[/p] [p]n[/p]')).toBe('adj. n');
    const expand = { abbreviations, expandLabels: true };
    expect(plain('[p]adj.[/p] [p] n [/p] [p][i]adj.[/i][/p]', expand)).toBe(
      'adjective n adjective',
    );
    expect(plain('[p]~ form[/p]', expand)).toBe('tilde form');
    // The abbreviations alone do not expand: expandLabels does.
    expect(plain('[p]adj.[/p]', { abbreviations })).toBe('adj.');
    expect(plain('[p]adj.[/p] x', { labels: false })).toBe('x');
    expect(plain('[p]adj.[/p] x', { ...expand, labels: false })).toBe('x');
    expect(zoneText(nodes('[trn][p]adj.[/p] x[/trn]'), { ...expand, labels: true })).toBe(
      'adjective x',
    );
  });

  it('gives the text of links', () => {
    expect(plain('see <<~ x>>, [ref]y[/ref], [ref dict="D"]z[/ref], [url]http://e[/url]')).toBe(
      'see ~ x, y, z, http://e',
    );
    expect(plain('<<~>>', { tilde: 'w' })).toBe('w');
  });

  it('renders sub-entries as lines: headwords, then content', async () => {
    const entry = await entryOf(
      'main\n\t[m1]a\n\t@ ~ one\n\t@ two\n\t[m2]b\n\tc ~\n\t@\n\t[m1]d\n',
    );
    expect(toPlainText(entry.body, { headwords: entry.headwords })).toBe(
      'a\nmain one\ntwo\nb\nc main\nd',
    );
    expect(toPlainText(entry.body, { headwords: entry.headwords, subentries: false })).toBe('a\nd');
    expect(toPlainText(entry.body, { headwords: entry.headwords, indent: '-' })).toBe(
      '-a\n-main one\n-two\n--b\n--c main\n-d',
    );
  });

  it("renders [']: plain letters by default, with U+0301 after each letter with stress: 'combining'", () => {
    const text = "пров[']и[/']нция, [b]a[']ei[/'][/b]";
    expect(plain(text)).toBe('провинция, aei');
    expect(plain(text, { stress: 'none' })).toBe('провинция, aei');
    expect(plain(text, { stress: 'combining' })).toBe('прови\u0301нция, ae\u0301i\u0301');
    expect(plain("[']~[/']", { tilde: 'o', stress: 'combining' })).toBe('o\u0301');
    // Zones too; punctuation inside the tag gets no accent.
    expect(
      zoneText(nodes("[trn]д[']о[/'][']-[/']м[/trn]"), { zones: ['trn'], stress: 'combining' }),
    ).toBe('до\u0301-м');
  });

  it('renders crossed tags as intended', () => {
    expect(plain('[trn][i]a[/trn] b[/i]')).toBe('a b');
    expect(plain('[b][i]x[/b]y[/i]')).toBe('xy');
  });

  it('checks its arguments', () => {
    for (const call of [
      () => toPlainText('x' as never),
      () => toPlainText([], null as never),
      () => toPlainText([], { tilde: 1 as never }),
      () => toPlainText([], { headwords: {} as never }),
      () => toPlainText([], { indent: 2 as never }),
      () => toPlainText([], { abbreviations: {} as never }),
      () => toPlainText([], { stress: 'acute' as never }),
      () => toPlainText([], { expandLabels: 'yes' as never }),
      () => zoneText([], { zones: 'trn' as never }),
      () => zoneText([], null as never),
    ]) {
      expect(thrown(call)).toMatchObject({ code: 'DSL0001' });
    }
  });
});

describe('zoneText', () => {
  it('gives one line per outermost zone, collapsed', () => {
    const tree = nodes('x [trn]a\n b[br]c[/trn] y [ex]d [com]e[/com][/ex] [com] [/com] z');
    expect(zoneText(tree)).toBe('a b c\nd e');
    expect(zoneText(tree, { zones: ['com'] })).toBe('e');
    expect(zoneText(tree, { zones: [] })).toBe('');
  });

  it('leaves out [!trs], labels and media, and zones inside [!trs]', () => {
    const tree = nodes(
      '[trn][p]adj.[/p] a [!trs]b[/!trs] [s]c.wav[/s][/trn] [!trs][ex]d[/ex][/!trs]',
    );
    expect(zoneText(tree)).toBe('a');
    expect(zoneText(tree, { zones: SEARCH_ZONES, labels: true, media: true })).toBe('adj. a c.wav');
  });

  it('includes [trn1], tildes and secondary text, and finds zones at any depth', () => {
    const tree = nodes('[m1][*][i][trn1]~ a[/trn1][/i][/*] [lang id=1033][ex]^~[/ex][/lang]');
    expect(zoneText(tree, { tilde: 'word' })).toBe('word a\nWord');
    expect(zoneText(tree, { tilde: 'word', secondary: false })).toBe('Word');
  });

  it('includes the zones of sub-entries unless subentries is false', async () => {
    const entry = await entryOf('w\n\t[trn]a[/trn]\n\t@ s\n\t[trn]b[/trn]\n\t@\n');
    expect(zoneText(entry.body)).toBe('a\nb');
    expect(zoneText(entry.body, { subentries: false })).toBe('a');
  });
});

describe('hasZones', () => {
  it('finds zone tags at any depth', async () => {
    expect(hasZones(nodes('plain [b]text[/b]'))).toBe(false);
    expect(hasZones(nodes('[m1][b][com]x[/com][/b]'))).toBe(true);
    expect(hasZones(nodes('[ex]x[/ex]'), ['trn'])).toBe(false);
    expect(hasZones((await entryOf('w\n\tx\n\t@ s\n\t[trn]b[/trn]\n\t@\n')).body)).toBe(true);
    expect(thrown(() => hasZones(null as never))).toMatchObject({ code: 'DSL0001' });
  });
});
