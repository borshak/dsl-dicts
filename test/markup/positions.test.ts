import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isParentNode,
  type MarkupNode,
  parseBody,
  parseMarkup,
  type SourcePosition,
  type TagNode,
  walk,
} from '../../src/index.js';
import { HEADER, positionOf, segment } from '../segment/helpers.js';
import { markupText } from './arbitraries.js';

describe('positions', () => {
  it('locate every node from its first character to after its last', () => {
    const text = 'ab[b]c[/b]~^~<<x>>[br]';
    const nodes = parseMarkup(text);
    expect(nodes.map((n) => [n.type, n.position?.offset, n.end?.offset])).toEqual([
      ['text', 0, 2],
      ['tag', 2, 10],
      ['tilde', 10, 11],
      ['tilde', 11, 13],
      ['link', 13, 18],
      ['lineBreak', 18, 22],
    ]);
    expect(nodes[1]).toMatchObject({
      position: { offset: 2, line: 1, column: 3 },
      children: [{ position: { offset: 5 }, end: { offset: 6 } }],
    });
  });

  it('span the escapes of a text node', () => {
    expect(parseMarkup('a\\[b')[0]).toMatchObject({
      text: 'a[b',
      position: { offset: 0 },
      end: { offset: 4 },
    });
  });

  it('place a line break from the end of a line to the start of the next', () => {
    const nodes = parseMarkup('ab\ncd');
    expect(nodes[1]).toEqual({
      type: 'lineBreak',
      origin: 'line',
      position: { offset: 2, line: 1, column: 3 },
      end: { offset: 3, line: 2, column: 1 },
    });
  });

  it('end implicitly closed tags where they are closed', () => {
    const nodes = parseMarkup('[b][i]x[/b]y');
    expect(nodes.map((n) => [n.position?.offset, n.end?.offset])).toEqual([
      [0, 11],
      [11, 12],
    ]);
    expect((nodes[0] as TagNode).children[0]).toMatchObject({
      position: { offset: 3 },
      end: { offset: 7 },
    });
  });

  it('start from the given origin', () => {
    const nodes = parseMarkup('x\n[b]y[/b]', { origin: { offset: 100, line: 7, column: 5 } });
    expect(nodes[0]?.position).toEqual({ offset: 100, line: 7, column: 5 });
    expect(nodes[2]?.position).toEqual({ offset: 102, line: 8, column: 1 });
  });

  it('use the positions and segments of a RawLine', () => {
    const line = {
      text: 'ab[b]c[/b]',
      position: { offset: 10, line: 3, column: 2 },
      segments: [
        { index: 0, position: { offset: 10, line: 3, column: 2 } },
        { index: 3, position: { offset: 20, line: 3, column: 12 } },
      ],
    };
    const nodes = parseMarkup(line);
    expect(nodes[1]).toMatchObject({ position: { offset: 12 }, end: { offset: 27 } });
  });

  it('can be switched off', () => {
    const nodes = parseMarkup('a[b]c[/b]\n~<<x>>', { positions: false });
    walk(nodes, (node) => {
      expect(node).not.toHaveProperty('position');
      expect(node).not.toHaveProperty('end');
    });
  });

  it('map body nodes back to the source', () => {
    const text = `${HEADER}w\n\t[m1]a {{c}}[b]b[/b]\n\t  c\n\t[*]@ s\n\t[i]x\n\t@[/*]\n\ty\n`;
    const nodes = parseBody(segment(text).entries[0] as never);
    const tags: string[] = [];
    walk(nodes, (node) => {
      if (node.type === 'tag') {
        tags.push(text.slice(node.position?.offset, (node.position?.offset ?? 0) + 3));
      }
    });
    expect(tags).toEqual(['[m1', '[b]', '[*]', '[i]']);
    expect(checkTree(text, nodes)).toBeUndefined();
  });

  it('are consistent and nested for any input', () => {
    fc.assert(
      fc.property(markupText, (text) => {
        expect(checkTree(text, parseMarkup(text))).toBeUndefined();
      }),
      { numRuns: 500 },
    );
  });
});

/**
 * Checks that positions agree with the source text: line and column match the offset, every
 * node starts before it ends, and children lie within their parent, in order.
 */
function checkTree(text: string, nodes: readonly MarkupNode[]): string | undefined {
  const check = (p: SourcePosition | undefined, what: string): string | undefined => {
    if (p === undefined) return `${what}: missing`;
    const expected = positionOf(text, p.offset);
    return expected.line === p.line && expected.column === p.column
      ? undefined
      : `${what}: ${JSON.stringify(p)}`;
  };
  const visit = (list: readonly MarkupNode[], from: number, to: number): string | undefined => {
    let last = from;
    for (const node of list) {
      const problem = check(node.position, node.type) ?? check(node.end, `${node.type} end`);
      if (problem !== undefined) return problem;
      const start = node.position?.offset ?? 0;
      const end = node.end?.offset ?? 0;
      if (start < last || end < start || end > to) {
        return `${node.type} at ${start}..${end} outside ${last}..${to}`;
      }
      if (isParentNode(node)) {
        const inner = visit(node.children, start, end);
        if (inner !== undefined) return inner;
      }
      last = end;
    }
  };
  return visit(nodes, 0, text.length);
}
