import { describe, expect, it } from 'vitest';
import { MAX_EXPANDED_LENGTH, MAX_VARIANTS } from '../../src/index.js';
import { show } from '../markup/helpers.js';
import { hw, variants } from './helpers.js';

const NBSP = String.fromCharCode(0xa0);

describe('plain headwords', () => {
  it('have one index form, the text itself', () => {
    const { headword, codes } = hw('hello world');
    expect(headword).toEqual({
      raw: 'hello world',
      display: [{ type: 'text', text: 'hello world' }],
      text: 'hello world',
      variants: ['hello world'],
    });
    expect(codes).toEqual([]);
  });

  it('are trimmed and have their spaces collapsed', () => {
    const { headword } = hw(' \t a \t  b  ');
    expect(headword.raw).toBe('a \t  b');
    expect(headword.text).toBe('a b');
    expect(headword.variants).toEqual(['a b']);
    expect(show(headword.display)).toBe('"a \\t  b"');
  });

  it('keep an escaped trailing space in raw, as a no-break space', () => {
    const { headword } = hw('a\\ ');
    expect(headword.raw).toBe('a\\ ');
    expect(headword.variants).toEqual([`a${NBSP}`]);
  });

  it('keep case and other characters as they are', () => {
    expect(variants('Ärger, 𝄞-#1 @ ^a')).toEqual(['Ärger, 𝄞-#1 @ ^a']);
  });
});

describe('optional parts ( )', () => {
  it('expand the manual example to four forms, in a deterministic order', () => {
    const { headword, codes } = hw('(пре)вращать(ся)');
    expect(headword.variants).toEqual(['вращать', 'вращаться', 'превращать', 'превращаться']);
    expect(headword.text).toBe('(пре)вращать(ся)');
    expect(show(headword.display)).toBe('"(пре)вращать(ся)"');
    expect(codes).toEqual([]);
  });

  it('expand the documented example in the documented order', () => {
    expect(variants('colo(u)r(s)')).toEqual(['color', 'colors', 'colour', 'colours']);
  });

  it('expand nested groups', () => {
    expect(variants('a(b(c)d)e')).toEqual(['ae', 'abde', 'abcde']);
    expect(variants('((a)b)')).toEqual(['b', 'ab']);
  });

  it('take the cartesian product of groups in sequence, the leftmost varying slowest', () => {
    expect(variants('(a)(b)(c)')).toEqual(['c', 'b', 'bc', 'a', 'ac', 'ab', 'abc']);
  });

  it('collapse the spaces around a removed part', () => {
    expect(variants('get (smth) back')).toEqual(['get back', 'get smth back']);
    expect(variants('(to) go')).toEqual(['go', 'to go']);
  });

  it('drop empty forms and duplicates', () => {
    expect(variants('(a)')).toEqual(['a']);
    expect(variants('()x')).toEqual(['x']);
    expect(variants('x( )')).toEqual(['x']);
    expect(variants('a(a)(a)')).toEqual(['a', 'aa', 'aaa']);
  });

  it('end an unclosed ( at the end of the headword', () => {
    const { headword, diagnostics } = hw('ab(cd(e');
    expect(headword.variants).toEqual(['ab', 'abcd', 'abcde']);
    expect(headword.text).toBe('ab(cd(e');
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([
      ['DSL3003', 3],
      ['DSL3003', 6],
    ]);
  });

  it('show a stray ) and ignore it in the index forms', () => {
    const { headword, diagnostics } = hw('a)b');
    expect(headword.variants).toEqual(['ab']);
    expect(headword.text).toBe('a)b');
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([['DSL3004', 2]]);
  });

  it('are literal when escaped', () => {
    const { headword, codes } = hw('вдохновить\\(ся\\)');
    expect(headword.variants).toEqual(['вдохновить(ся)']);
    expect(headword.text).toBe('вдохновить(ся)');
    expect(codes).toEqual([]);
  });
});

describe('unsortable parts { }', () => {
  it('are shown but not indexed', () => {
    const { headword, codes } = hw('{to }tell{ smb}');
    expect(headword.text).toBe('to tell smb');
    expect(headword.variants).toEqual(['tell']);
    expect(show(headword.display)).toBe('"to tell smb"');
    expect(codes).toEqual([]);
  });

  it('hold stress tags whose content is sortable', () => {
    const { headword, codes } = hw("{[']}a{[/']}bc");
    expect(show(headword.display)).toBe('\'("a") "bc"');
    expect(headword.text).toBe('abc');
    expect(headword.variants).toEqual(['abc']);
    expect(codes).toEqual([]);
  });

  it('hold labels', () => {
    const { headword, codes } = hw('word {[p]}adj.{[/p]}');
    expect(show(headword.display)).toBe('"word " p("adj.")');
    expect(headword.variants).toEqual(['word adj.']);
    expect(codes).toEqual([]);
    expect(variants('word {[p]adj.[/p]}')).toEqual(['word']);
  });

  it('follow the manual example', () => {
    const { headword, codes } = hw(
      '{[c slategray]}{to }{[/c]}tell {[c slategray]}smb{[/c]} how to do {[c slategray]}smth{[/c]}',
    );
    expect(show(headword.display)).toBe(
      'c{color=slategray}("to ") "tell " c{color=slategray}("smb") " how to do " c{color=slategray}("smth")',
    );
    expect(headword.text).toBe('to tell smb how to do smth');
    expect(headword.variants).toEqual(['tell smb how to do smth']);
    expect(codes).toEqual([]);
  });

  it('hide optional parts inside them, and may sit inside optional parts', () => {
    expect(variants('a{(b)}c')).toEqual(['ac']);
    expect(hw('a{(b)}c').headword.text).toBe('a(b)c');
    expect(variants('colo(u{[sup]1[/sup]})r')).toEqual(['color', 'colour']);
  });

  it('nest', () => {
    expect(variants('a{b{c}d}e')).toEqual(['ae']);
  });

  it('make the rest unsortable when not closed', () => {
    const { headword, diagnostics } = hw('ab{cd');
    expect(headword.variants).toEqual(['ab']);
    expect(headword.text).toBe('abcd');
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([['DSL3001', 3]]);
  });

  it('ignore a stray }', () => {
    const { headword, diagnostics } = hw('a}b');
    expect(headword.variants).toEqual(['ab']);
    expect(headword.text).toBe('ab');
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([['DSL3002', 2]]);
  });

  it('are literal when escaped', () => {
    const { headword, codes } = hw('\\{a\\}');
    expect(headword.variants).toEqual(['{a}']);
    expect(codes).toEqual([]);
  });

  it('leave no index form when they hold everything', () => {
    const { headword, codes } = hw("{[']}{[/']}{only}");
    expect(headword.variants).toEqual([]);
    expect(headword.text).toBe('only');
    expect(codes).toEqual(['DSL3201']);
    expect(hw('{ } ( )').codes).toEqual(['DSL3201']);
  });
});

describe('markup', () => {
  it('outside braces is parsed and reported once', () => {
    const { headword, diagnostics } = hw('a [b]x[/b] [i]y[/i]');
    expect(show(headword.display)).toBe('"a " b("x") " " i("y")');
    expect(headword.variants).toEqual(['a x y']);
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([['DSL3101', 3]]);
  });

  it('can span braces and parentheses', () => {
    const { headword, codes } = hw('{[b]}a(b){[/b]}c');
    expect(show(headword.display)).toBe('b("a(b)") "c"');
    expect(headword.variants).toEqual(['ac', 'abc']);
    expect(codes).toEqual([]);
  });

  it('is never part of the index forms, even when shown as text', () => {
    const { headword, codes } = hw('a[foo]b');
    expect(show(headword.display)).toBe('"a[foo]b"');
    expect(headword.variants).toEqual(['ab']);
    expect(codes).toEqual(['DSL3101', 'DSL4102']);
  });

  it('is recovered like body markup', () => {
    const { headword, codes } = hw("{[']}a");
    expect(show(headword.display)).toBe('\'("a")');
    expect(codes).toEqual(['DSL4202']);
  });

  it('turns [br] into a space in the plain text', () => {
    const { headword } = hw('a{[br]}b');
    expect(show(headword.display)).toBe('"a" [br] "b"');
    expect(headword.text).toBe('a b');
    expect(headword.variants).toEqual(['ab']);
  });

  it('resolves escapes, with ^ literal except in ^~', () => {
    const { headword, codes } = hw('\\[x\\] \\\\ \\~ ^a [[y]]');
    expect(headword.variants).toEqual(['[x] \\ ~ ^a [y]']);
    expect(codes).toEqual([]);
  });

  it('keeps links as links in the display', () => {
    const { headword, codes } = hw('a <<b>>');
    expect(show(headword.display)).toBe('"a " <<"b">>');
    expect(headword.variants).toEqual(['a b']);
    expect(codes).toEqual(['DSL3101']);
  });
});

describe('tildes', () => {
  it('are substituted in text and index forms, and kept in the display', () => {
    const { headword, codes } = hw('~ (out)', { tilde: 'Go' });
    expect(show(headword.display)).toBe('~ " (out)"');
    expect(headword.text).toBe('Go (out)');
    expect(headword.variants).toEqual(['Go', 'Go out']);
    expect(codes).toEqual([]);
  });

  it('flip the case of the first character with ^~', () => {
    expect(variants('^~ a', { tilde: 'Go' })).toEqual(['go a']);
    expect(variants('^~', { tilde: 'éa' })).toEqual(['Éa']);
    expect(variants('^~', { tilde: '𐐨x' })).toEqual(['𐐀x']);
    expect(variants('^~', { tilde: '1a' })).toEqual(['1a']);
    expect(hw('^~').headword.display).toEqual([{ type: 'tilde', flipCase: true }]);
  });

  it('are kept as text when there is nothing to stand for', () => {
    const { headword, diagnostics } = hw('a ~ ^~');
    expect(headword.variants).toEqual(['a ~ ^~']);
    expect(headword.text).toBe('a ~ ^~');
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([['DSL3102', 3]]);
  });

  it('are not substituted when escaped', () => {
    expect(variants('\\~ \\^~', { tilde: 'x' })).toEqual(['~ ^x']);
  });
});

describe('limits', () => {
  it('do not expand a headword whose sortable text is too long', () => {
    const long = `${'a'.repeat(MAX_EXPANDED_LENGTH)}(b)`;
    const { headword, codes } = hw(long);
    expect(headword.variants).toEqual([long]);
    expect(codes).toEqual(['DSL3202']);
    // The unsortable part does not count.
    const braced = `{${'a'.repeat(MAX_EXPANDED_LENGTH)}}x(b)`;
    expect(hw(braced).headword.variants).toEqual(['x', 'xb']);
    expect(hw(braced).codes).toEqual([]);
    // A long headword without optional parts is fine.
    expect(hw('a'.repeat(1000)).codes).toEqual([]);
  });

  it('keep at most the first combinations', () => {
    const groups = '(a)(b)(c)(d)(e)(f)(g)(h)(i)';
    const { headword, codes } = hw(groups);
    expect(codes).toEqual(['DSL3203']);
    // 2^9 = 512 combinations; the first 256 are those without (a), minus the empty one.
    expect(headword.variants).toHaveLength(MAX_VARIANTS - 1);
    expect(headword.variants.every((v) => !v.includes('a'))).toBe(true);
    expect(headword.variants[0]).toBe('i');
    expect(headword.variants.at(-1)).toBe('bcdefghi');
    const exact = hw('(a)(b)(c)(d)(e)(f)(g)(h)');
    expect(exact.codes).toEqual([]);
    expect(exact.headword.variants).toHaveLength(255);
  });

  it('stay fast on many nested groups', () => {
    const nested = `${'('.repeat(200)}x${')'.repeat(200)}`;
    expect(variants(nested)).toEqual(['x']);
    const sequence = '(ab)'.repeat(120);
    const { headword, codes } = hw(sequence);
    expect(codes).toEqual(['DSL3203']);
    expect(headword.variants.length).toBeLessThanOrEqual(MAX_VARIANTS);
  });
});
