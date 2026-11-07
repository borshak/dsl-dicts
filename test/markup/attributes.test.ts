import { describe, expect, it } from 'vitest';
import type { TagNode } from '../../src/index.js';
import { parse } from './helpers.js';

function tag(text: string): { node: TagNode; codes: readonly string[] } {
  const { nodes, codes } = parse(text);
  return { node: nodes[0] as TagNode, codes };
}

describe('attributes', () => {
  it('gives [m] and [mN] a level from the name', () => {
    expect(tag('[m]x').node).toMatchObject({ name: 'm', attrs: { level: 0 } });
    expect(tag('[m0]x').node.attrs).toEqual({ level: 0 });
    expect(tag('[m7]x').node.attrs).toEqual({ level: 7 });
    expect(tag('[m7]x').node).not.toHaveProperty('rawAttrs');
  });

  it('treats [m10] as an unknown tag', () => {
    expect(tag('[m10]x').codes).toEqual(['DSL4102']);
  });

  it('reads the color of [c]', () => {
    expect(tag('[c]x[/c]').node.attrs).toEqual({});
    expect(tag('[c darkgreen]x[/c]').node).toMatchObject({
      attrs: { color: 'darkgreen' },
      rawAttrs: 'darkgreen',
    });
  });

  it('keeps an unknown color, with a diagnostic', () => {
    const { node, codes } = tag('[c Red]x[/c]');
    expect(node.attrs).toEqual({ color: 'Red' });
    expect(codes).toEqual(['DSL4106']);
  });

  it('ignores a malformed color', () => {
    const { node, codes } = tag('[c red blue]x[/c]');
    expect(node).toMatchObject({ attrs: {}, rawAttrs: 'red blue' });
    expect(codes).toEqual(['DSL4104']);
  });

  it('reads [lang id=...] and [lang name="..."]', () => {
    expect(tag('[lang id=1033]x[/lang]').node.attrs).toEqual({ id: 1033 });
    expect(tag('[lang id="1049"]x[/lang]').node.attrs).toEqual({ id: 1049 });
    expect(tag('[lang id=2]x[/lang]').node.attrs).toEqual({ id: 2 });
    expect(tag('[lang name="German"]x[/lang]').node.attrs).toEqual({ name: 'German' });
    expect(tag('[lang  name = "German" ]x[/lang]').node.attrs).toEqual({ name: 'German' });
    expect(tag('[lang name=German]x[/lang]').codes).toEqual([]);
  });

  it('keeps unknown language ids and names, with a diagnostic', () => {
    expect(tag('[lang id=9999]x[/lang]')).toMatchObject({
      node: { attrs: { id: 9999 } },
      codes: ['DSL4106'],
    });
    expect(tag('[lang name="english"]x[/lang]')).toMatchObject({
      node: { attrs: { name: 'english' } },
      codes: ['DSL4106'],
    });
  });

  it('reports [lang] without attributes and malformed ones', () => {
    expect(tag('[lang]x[/lang]').codes).toEqual(['DSL4105']);
    expect(tag('[lang id=x]x[/lang]').codes).toEqual(['DSL4104']);
    expect(tag('[lang id]x[/lang]').codes).toEqual(['DSL4104']);
    expect(tag('[lang name="x]x[/lang]').codes).toEqual(['DSL4104']);
    expect(tag('[lang =1]x[/lang]').codes).toEqual(['DSL4104', 'DSL4105']);
    expect(tag('[lang dict="x"]x[/lang]').codes).toEqual(['DSL4104']);
    expect(tag('[lang id=1033 id=1049]x[/lang]')).toMatchObject({
      node: { attrs: { id: 1033 } },
      codes: ['DSL4104'],
    });
  });

  it('reads dict and the undocumented target of [ref] and [url]', () => {
    expect(tag('[ref dict="Other dictionary"]x[/ref]').node.attrs).toEqual({
      dict: 'Other dictionary',
    });
    expect(tag('[ref target="a b" dict=D]x[/ref]').node.attrs).toEqual({
      target: 'a b',
      dict: 'D',
    });
    expect(tag('[url target="https://example.com/"]x[/url]').node.attrs).toEqual({
      target: 'https://example.com/',
    });
    expect(tag('[url dict="x"]y[/url]').codes).toEqual(['DSL4104']);
  });

  it('resolves escapes in values but keeps the raw text', () => {
    const { node } = tag('[ref dict="a \\"b\\" c"]x[/ref]');
    expect(node.attrs).toEqual({ dict: 'a "b" c' });
    expect(node.rawAttrs).toBe('dict="a \\"b\\" c"');
  });

  it('ignores attributes of tags that take none', () => {
    const { node, codes } = tag('[b big]x[/b]');
    expect(node).toMatchObject({ attrs: {}, rawAttrs: 'big' });
    expect(codes).toEqual(['DSL4103']);
  });

  it('ignores attributes of closing tags', () => {
    expect(parse('[b]x[/b big]').codes).toEqual(['DSL4103']);
  });

  it('keeps the raw attributes of unknown tags', () => {
    const { node, codes } = tag('[zz a=1 "b"]x[/zz]');
    expect(node).toMatchObject({ name: 'zz', attrs: {}, rawAttrs: 'a=1 "b"' });
    expect(codes).toEqual(['DSL4101']);
  });

  it('shares one frozen object for empty attributes', () => {
    const { nodes } = parse('[b]x[/b][i]y[/i]');
    const [b, i] = nodes as TagNode[];
    expect(b?.attrs).toBe(i?.attrs);
    expect(Object.isFrozen(b?.attrs)).toBe(true);
  });
});
