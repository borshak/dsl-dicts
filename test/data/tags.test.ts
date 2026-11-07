import { describe, expect, it } from 'vitest';
import { getMarginLevel, getTagSpec, TAGS } from '../../src/data/index.js';

const EXPECTED = [
  'b',
  'i',
  'u',
  'c',
  'sup',
  'sub',
  'm',
  "'",
  'br',
  'p',
  't',
  '*',
  'ex',
  'com',
  'trn',
  'trn1',
  '!trs',
  'lang',
  's',
  'video',
  'preview',
  'ref',
  'url',
];

describe('tag registry', () => {
  it('has unique names', () => {
    const names = TAGS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('contains exactly the documented tags', () => {
    expect(TAGS.map((t) => t.name).sort()).toEqual([...EXPECTED].sort());
    for (const name of EXPECTED) expect(getTagSpec(name), name).toBeDefined();
  });

  it('describes every tag', () => {
    for (const t of TAGS) expect(t.description.length).toBeGreaterThan(0);
  });

  it('marks [br] as unpaired and everything else as paired', () => {
    expect(getTagSpec('br')?.paired).toBe(false);
    expect(TAGS.filter((t) => !t.paired).map((t) => t.name)).toEqual(['br']);
  });

  it('forbids nested tags exactly in [t], [s], [video], [ref] and [url]', () => {
    const names = TAGS.filter((t) => 'noNestedTags' in t).map((t) => t.name);
    expect(names.sort()).toEqual(['ref', 's', 't', 'url', 'video']);
    expect(getTagSpec('t')?.noNestedTags).toBe(true);
  });

  it('makes [m] closing optional with a level attribute', () => {
    expect(getTagSpec('m')).toMatchObject({ closeOptional: true, attrs: 'level', paired: true });
    expect(TAGS.filter((t) => 'closeOptional' in t).map((t) => t.name)).toEqual(['m']);
  });

  it('gives [c] a color attribute and [lang] a required lang attribute', () => {
    expect(getTagSpec('c')?.attrs).toBe('color');
    expect(getTagSpec('lang')).toMatchObject({ attrs: 'lang', attrsRequired: true });
  });

  it('knows which tags may appear in headwords', () => {
    const allowed = TAGS.filter((t) => 'allowedInHeadword' in t).map((t) => t.name);
    expect(allowed.sort()).toEqual(
      ["'", '*', 'br', 'c', 'p', 'ref', 's', 'sub', 'sup', 't', 'url', 'video'].sort(),
    );
  });

  it('flags undocumented tags', () => {
    const undocumented = TAGS.filter((t) => 'dialect' in t && t.dialect === 'undocumented');
    expect(undocumented.map((t) => t.name).sort()).toEqual(
      ['br', 'preview', 't', 'trn1', 'video'].sort(),
    );
  });

  it('restricts [preview] to media parents', () => {
    expect(getTagSpec('preview')?.parents).toEqual(['s', 'video']);
  });
});

describe('getTagSpec', () => {
  it('maps m0..m9 to the m spec', () => {
    const m = getTagSpec('m');
    for (let level = 0; level <= 9; level++) expect(getTagSpec(`m${level}`)).toBe(m);
  });

  it('returns undefined for unknown, mis-cased or malformed names', () => {
    for (const name of ['', 'B', 'M', 'm10', 'm-1', 'mm', 'foo', 'toString', '/b']) {
      expect(getTagSpec(name), name).toBeUndefined();
    }
  });
});

describe('getMarginLevel', () => {
  it('extracts the level of m0..m9', () => {
    expect(getMarginLevel('m0')).toBe(0);
    expect(getMarginLevel('m3')).toBe(3);
    expect(getMarginLevel('m9')).toBe(9);
  });

  it('returns undefined for bare m and other names', () => {
    expect(getMarginLevel('m')).toBeUndefined();
    expect(getMarginLevel('m10')).toBeUndefined();
    expect(getMarginLevel('b')).toBeUndefined();
  });
});
