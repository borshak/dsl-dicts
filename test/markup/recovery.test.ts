import { describe, expect, it } from 'vitest';
import { parse, show } from './helpers.js';

/** One fixture per recovery rule of the tree builder. */
describe('recovery rules', () => {
  describe('margins [m]', () => {
    it('need no closing tag: a new [m...] closes the open one', () => {
      const { nodes, codes } = parse('[m1]a[m2]b[m]c');
      expect(show(nodes)).toBe('m{level=1}("a") m{level=2}("b") m{level=0}("c")');
      expect(codes).toEqual([]);
    });

    it('[/m] closes a margin of any level', () => {
      const { nodes, codes } = parse('[m3]a[/m]b[m0]c[/m3]d');
      expect(show(nodes)).toBe('m{level=3}("a") "b" m{level=0}("c") "d"');
      expect(codes).toEqual([]);
    });

    it('are block-level: open tags are closed and reopened inside the new margin', () => {
      const { nodes, codes } = parse('[m1][*]a[m2]b[/*]c');
      expect(show(nodes)).toBe('m{level=1}(*("a")) m{level=2}(*("b") "c")');
      expect(codes).toEqual([]);
    });

    it('move an empty tag opened before them inside', () => {
      const { nodes, codes } = parse('x [b][m1]y[/b]');
      expect(show(nodes)).toBe('"x " m{level=1}(b("y"))');
      expect(codes).toEqual([]);
    });

    it('report [/m] with open tags inside as crossed', () => {
      const { nodes, codes } = parse('[m1][b]a[/m]b[/b]');
      expect(show(nodes)).toBe('m{level=1}(b("a")) b("b")');
      expect(codes).toEqual(['DSL4203']);
    });

    it('may stay open at the end without a diagnostic', () => {
      expect(parse('[m1]a').codes).toEqual([]);
    });
  });

  describe('crossed nesting', () => {
    it('closes the tags above, closes the tag, and reopens them', () => {
      const { nodes, diagnostics } = parse('[b][i]x[/b]y[/i]');
      expect(show(nodes)).toBe('b(i("x")) i("y")');
      expect(diagnostics).toMatchObject([{ code: 'DSL4203', position: { column: 8 } }]);
    });

    it('reopens several tags in order', () => {
      expect(show(parse('[b][i][u]x[/b]y[/u][/i]').nodes)).toBe('b(i(u("x"))) i(u("y"))');
    });

    it('removes a reopened tag that stays empty', () => {
      expect(show(parse('[b][i]x[/b][/i]y').nodes)).toBe('b(i("x")) "y"');
    });

    it('keeps tags that were empty when written', () => {
      expect(show(parse('[b][i][/b][/i]').nodes)).toBe('b(i())');
    });
  });

  describe('stray and unclosed tags', () => {
    it('ignores a closing tag without an opening one', () => {
      const { nodes, diagnostics } = parse('a[/b]c[/m]');
      expect(show(nodes)).toBe('"ac"');
      expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([
        ['DSL4201', 2],
        ['DSL4201', 7],
      ]);
    });

    it('closes tags left open at the end, reporting each but [m]', () => {
      const { nodes, diagnostics } = parse('[m1][b]a[i]b');
      expect(show(nodes)).toBe('m{level=1}(b("a" i("b")))');
      expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([
        ['DSL4202', 5],
        ['DSL4202', 9],
      ]);
    });

    it('reports a reopened tag that is never closed once, at its opening tag', () => {
      const { diagnostics } = parse('[b]a[m1]b');
      expect(diagnostics.map((d) => [d.code, d.position?.column])).toEqual([['DSL4202', 1]]);
    });

    it('ignores a [/br] and attributes of [br]', () => {
      const { nodes, codes } = parse('a[br x]b[/br]');
      expect(show(nodes)).toBe('"a" [br] "b"');
      expect(codes).toEqual(['DSL4103', 'DSL4201']);
    });
  });

  describe('same tag nested', () => {
    it('nests it and reports it', () => {
      const { nodes, codes } = parse('[b]a[b]b[/b]c[/b]');
      expect(show(nodes)).toBe('b("a" b("b") "c")');
      expect(codes).toEqual(['DSL4204']);
    });

    it('does not report different colors nested in each other twice', () => {
      expect(parse('[c red]a[c blue]b[/c][/c]').codes).toEqual(['DSL4204']);
    });
  });

  describe('text-only tags', () => {
    it.each(['t', 's', 'video', 'ref', 'url'])('keeps the content of [%s] as text', (name) => {
      const { nodes, codes } = parse(`[${name}]a[b]b[/b]<<c>>[/i]~[/${name}]`);
      expect(show(nodes)).toBe(`${name}("a[b]b[/b]<<c>>[/i]" ~)`);
      expect(codes).toEqual(['DSL4205', 'DSL4205', 'DSL4205', 'DSL4205']);
    });

    it('allows [preview] inside [s] and [video]', () => {
      const { nodes, codes } = parse(
        '[s]a.png[preview]b[/preview][/s][video]v[preview][/preview][/video]',
      );
      expect(show(nodes)).toBe('s("a.png" preview("b")) video("v" preview())');
      expect(codes).toEqual([]);
    });

    it('swallows an unclosed text-only tag up to the end', () => {
      const { nodes, codes } = parse('[t]a[b]x');
      expect(show(nodes)).toBe('t("a[b]x")');
      expect(codes).toEqual(['DSL4202', 'DSL4205']);
    });
  });

  describe('parents', () => {
    it('keeps [preview] outside [s] and [video] but reports it', () => {
      const { nodes, codes } = parse('[preview]x[/preview][b][preview]y[/preview][/b]');
      expect(show(nodes)).toBe('preview("x") b(preview("y"))');
      expect(codes).toEqual(['DSL4206', 'DSL4206']);
    });
  });

  describe('unknown tags', () => {
    it('are tags when a closing tag follows', () => {
      const { nodes, diagnostics } = parse('[foo x=1]a[b]b[/foo][/b]');
      expect(nodes[0]).toMatchObject({ type: 'tag', name: 'foo', rawAttrs: 'x=1', attrs: {} });
      expect(show(nodes)).toBe('foo("a" b("b"))');
      expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
        ['DSL4101', 'warning'],
        ['DSL4203', 'info'],
      ]);
    });

    it('are text without a closing tag', () => {
      const { nodes, diagnostics } = parse('[in] a [/out]');
      expect(show(nodes)).toBe('"[in] a [/out]"');
      expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
        ['DSL4102', 'info'],
        ['DSL4102', 'info'],
      ]);
    });

    it('include mis-cased names, with a hint', () => {
      const { nodes, diagnostics } = parse('[B]x[/B] [I]y');
      expect(show(nodes)).toBe('B("x") " [I]y"');
      expect(diagnostics[0]?.message).toMatch(/\[b\]/);
    });

    it('are matched by a closing tag on a later line', () => {
      expect(show(parse('[zz]a\nb[/zz]').nodes)).toBe('zz("a" / "b")');
    });
  });

  describe('depth', () => {
    it('keeps tags beyond 64 levels as text', () => {
      const deep = '[b]'.repeat(70);
      const { nodes, codes } = parse(`${deep}x`);
      let depth = 0;
      let node = nodes[0];
      while (node?.type === 'tag') {
        depth++;
        node = node.children[0];
      }
      expect(depth).toBe(64);
      expect(node).toEqual({ type: 'text', text: `${'[b]'.repeat(6)}x` });
      expect(codes.filter((c) => c === 'DSL4207')).toHaveLength(6);
    });
  });
});

describe('line breaks', () => {
  it('separate the content of lines, inside the tags open there', () => {
    expect(show(parse('[*]a\nb[/*]').nodes)).toBe('*("a" / "b")');
  });

  it('come after closing tags at the start of a line', () => {
    expect(show(parse('[b]a\n[/b]c').nodes)).toBe('b("a") / "c"');
  });

  it('come before an opening tag at the start of a line', () => {
    expect(show(parse('a\n[b]c[/b]').nodes)).toBe('"a" / b("c")');
  });

  it('are not added before a margin, at the start or at the end', () => {
    expect(show(parse('\n[m1]a\n[m2]b\n[/m]\n').nodes)).toBe('m{level=1}("a") m{level=2}("b")');
  });

  it('collapse over lines without content', () => {
    expect(show(parse('a\n[/b]\nc').nodes)).toBe('"a" / "c"');
  });

  it('keep [br] distinct from line breaks', () => {
    expect(parse('a[br]\nb').nodes).toEqual([
      { type: 'text', text: 'a' },
      { type: 'lineBreak', origin: 'tag' },
      { type: 'lineBreak', origin: 'line' },
      { type: 'text', text: 'b' },
    ]);
  });
});

describe('regressions found by the round-trip property', () => {
  it('drops a line break left right before a margin', () => {
    expect(show(parse('[b]\n[b][m2]').nodes)).toBe('m{level=2}()');
  });

  it('does not reopen tags inside text-only content', () => {
    expect(show(parse('[s][preview][b][/preview][b]').nodes)).toBe('s(preview(b()) "[b]")');
  });
});
