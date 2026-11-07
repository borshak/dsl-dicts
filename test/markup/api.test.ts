import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AST_VERSION,
  createCollectingSink,
  createStrictSink,
  type DeepReadonly,
  DslError,
  isParentNode,
  type MarkupNode,
  parseBody,
  parseMarkup,
  type TagNode,
  walk,
} from '../../src/index.js';
import { parse, show } from './helpers.js';

describe('API', () => {
  it('exports the AST version', () => {
    expect(AST_VERSION).toBe(1);
  });

  it('rejects invalid arguments with DSL0001', () => {
    const bad: unknown[] = [
      () => parseMarkup(42 as never),
      () => parseMarkup('x', null as never),
      () => parseBody(null as never),
      () => parseBody({ body: 'x' } as never),
    ];
    for (const call of bad) {
      expect(call).toThrow(DslError);
      expect(call).toThrow(expect.objectContaining({ code: 'DSL0001' }) as never);
    }
  });

  it('reports diagnostics with severity, message and position', () => {
    const sink = createCollectingSink();
    parseMarkup('a\n [b]x', { diagnostics: sink });
    expect(sink.diagnostics).toEqual([
      {
        code: 'DSL4202',
        severity: 'warning',
        message: expect.stringContaining('[b]'),
        position: { offset: 3, line: 2, column: 2 },
      },
    ]);
  });

  it('throws from a strict sink only for errors', () => {
    expect(() => parseMarkup('[b]x[/i]', { diagnostics: createStrictSink() })).not.toThrow();
  });

  it('can be frozen deeply: the parser keeps no references', () => {
    const nodes = parseMarkup('[b]x[/b]');
    deepFreeze(nodes);
    expect(parseMarkup('[b]x[/b]')).toEqual(nodes);
  });

  it('types the AST as read-only', () => {
    const nodes: readonly MarkupNode[] = parseMarkup('[b]x[/b]');
    expectTypeOf(nodes[0] as TagNode).toHaveProperty('children');
    expectTypeOf<DeepReadonly<{ a: { b: string[] } }>>().toEqualTypeOf<{
      readonly a: { readonly b: readonly string[] };
    }>();
    const tag = nodes[0] as TagNode;
    // @ts-expect-error The AST is read-only.
    tag.name = 'i';
  });
});

describe('walk', () => {
  const nodes = parse('a[b]b[i]c[/i][/b]<<d>>').nodes;

  it('visits nodes depth first, with parents and indexes', () => {
    const seen: string[] = [];
    walk(nodes, {
      enter(node, parent, index) {
        seen.push(`+${node.type}:${parent?.type ?? '-'}:${index}`);
      },
      leave(node) {
        seen.push(`-${node.type}`);
      },
    });
    expect(seen).toEqual([
      '+text:-:0',
      '-text',
      '+tag:-:1',
      '+text:tag:0',
      '-text',
      '+tag:tag:1',
      '+text:tag:0',
      '-text',
      '-tag',
      '-tag',
      '+link:-:2',
      '+text:link:0',
      '-text',
      '-link',
    ]);
  });

  it('skips children and stops', () => {
    const texts: string[] = [];
    const completed = walk(nodes, (node) => {
      if (node.type === 'tag') return 'skip';
      if (node.type === 'text') texts.push(node.text);
      if (node.type === 'link') return 'stop';
    });
    expect(completed).toBe(false);
    expect(texts).toEqual(['a']);
    expect(walk([], () => 'stop')).toBe(true);
  });

  it('knows which nodes have children', () => {
    expect(nodes.map(isParentNode)).toEqual([false, true, true]);
    expect(show(nodes)).toBe('"a" b("b" i("c")) <<"d">>');
  });
});

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
}
