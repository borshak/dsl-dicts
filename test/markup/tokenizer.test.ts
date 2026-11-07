import { describe, expect, it } from 'vitest';
import { parse, show } from './helpers.js';

const NBSP = String.fromCharCode(0xa0);

describe('text and escapes', () => {
  it('keeps plain text as one node', () => {
    expect(parse('plain text, 1-2').nodes).toEqual([{ type: 'text', text: 'plain text, 1-2' }]);
  });

  it('makes any escaped character literal', () => {
    expect(show(parse('\\[b\\] \\~ \\^ \\<\\<x\\>\\> \\@ \\# \\\\ \\a').nodes)).toBe(
      '"[b] ~ ^ <<x>> @ # \\\\ a"',
    );
  });

  it('turns an escaped space into a no-break space, except in [s] and [video]', () => {
    expect(show(parse('a\\ b [s]c\\ d.wav[/s] [video]e\\ f[/video]').nodes)).toBe(
      '"a b " s("c d.wav") " " video("e f")',
    );
  });

  it('keeps a backslash at the end of a line', () => {
    const { nodes, diagnostics } = parse('a\\\nb\\');
    expect(show(nodes)).toBe('"a\\\\" / "b\\\\"');
    expect(diagnostics.map((d) => [d.code, d.position?.line, d.position?.column])).toEqual([
      ['DSL4003', 1, 2],
      ['DSL4003', 2, 2],
    ]);
  });

  it('reads doubled brackets as literal brackets', () => {
    expect(show(parse('[[1]] [[b]] x]y').nodes)).toBe('"[1] [b] x]y"');
    expect(show(parse('[[[b]x[/b]').nodes)).toBe('"[" b("x")');
    expect(parse('[[1]]').codes).toEqual([]);
  });

  it('escapes surrogate pairs as one character', () => {
    expect(parse('\\😀^𐐨').nodes).toEqual([{ type: 'text', text: '😀𐐀' }]);
  });
});

describe('tags', () => {
  it('reads opening and closing tags with attributes', () => {
    expect(show(parse("[b]x[/b][c  red ]y[/c]['][/']").nodes)).toBe(
      'b("x") c{color=red}("y") \'()',
    );
  });

  it('ends a tag at the first unescaped ]', () => {
    const { nodes } = parse('[ref dict="a\\]b"]x[/ref]');
    expect(nodes).toMatchObject([
      { name: 'ref', rawAttrs: 'dict="a\\]b"', attrs: { dict: 'a]b' } },
    ]);
  });

  it('keeps an unterminated [ as text', () => {
    const { nodes, diagnostics } = parse('a [b c\n[i x');
    expect(show(nodes)).toBe('"a [b c" / "[i x"');
    expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([
      ['DSL4001', 3],
      ['DSL4001', 1],
    ]);
  });

  it('keeps a [ followed by another [ as text and reads the second', () => {
    const { nodes, codes } = parse('[a[b]x[/b]');
    expect(show(nodes)).toBe('"[a" b("x")');
    expect(codes).toEqual(['DSL4001']);
  });

  it('keeps empty and malformed tags as text', () => {
    const { nodes, codes } = parse('[] [/] [ b] [/ b] [a\\b]');
    expect(show(nodes)).toBe('"[] [/] [ b] [/ b] [ab]"');
    expect(codes).toEqual(['DSL4002', 'DSL4002', 'DSL4002', 'DSL4002', 'DSL4002']);
  });

  it('does not let a tag span lines', () => {
    expect(parse('[b\n]x').codes).toEqual(['DSL4001']);
  });
});

describe('links', () => {
  it('reads <<target>> as a link', () => {
    expect(parse('see <<word>>.').nodes).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', children: [{ type: 'text', text: 'word' }] },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps single angle brackets as text', () => {
    expect(show(parse('a < b > c <x> \\<<y>>').nodes)).toBe('"a < b > c <x> <<y>>"');
  });

  it('ends a link at the first unescaped >>', () => {
    expect(show(parse('<<a\\>>b>>c>>').nodes)).toBe('<<"a>>b">> "c>>"');
  });

  it('keeps tags inside a link as text and tildes as tildes', () => {
    const { nodes, codes } = parse('<<[b]x[/b] ~>>');
    expect(show(nodes)).toBe('<<"[b]x[/b] " ~>>');
    expect(codes).toEqual(['DSL4205', 'DSL4205']);
  });

  it('keeps an unclosed or empty link as text', () => {
    const { nodes, codes } = parse('<<a\n<<>> b');
    expect(show(nodes)).toBe('"<<a" / "<<>> b"');
    expect(codes).toEqual(['DSL4005', 'DSL4006']);
  });

  it('does not nest links', () => {
    expect(show(parse('<<a <<b>> c>>').nodes)).toBe('<<"a <<b">> " c>>"');
  });
});

describe('tilde and caret', () => {
  it('reads ~ and ^~ as tilde nodes', () => {
    expect(parse('~ ^~').nodes).toEqual([
      { type: 'tilde', flipCase: false },
      { type: 'text', text: ' ' },
      { type: 'tilde', flipCase: true },
    ]);
  });

  it('flips the case of the next letter (manual), escaped or not', () => {
    const { nodes, codes } = parse('^abc ^Abc ^\\a ^ж ^Ж ^ǆ');
    expect(show(nodes)).toBe('"Abc abc A Ж ж Ǆ"');
    expect(codes).toEqual([]);
  });

  it('keeps a ^ that has nothing to flip as text', () => {
    const { nodes, codes } = parse('^[b]x[/b] ^<<y>> ^^a ^1 ^, (^) ^\\] ^[[ ^\\ ^');
    expect(show(nodes)).toBe('"^" b("x") " ^" <<"y">> " ^A ^1 ^, (^) ^] ^[ ^' + NBSP + '^"');
    expect(codes).toHaveLength(10);
    expect(new Set(codes)).toEqual(new Set(['DSL4004']));
  });
});

describe('characters that are not markup in a body', () => {
  it('keeps @, #, braces and parentheses as text', () => {
    expect(show(parse('mail@example #1 {a} (b) {{c}}').nodes)).toBe(
      '"mail@example #1 {a} (b) {{c}}"',
    );
  });
});
