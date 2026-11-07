import { describe, expect, it } from 'vitest';
import { parseBody, type RawEntry, type SubentryNode } from '../../src/index.js';
import { HEADER, segment } from '../segment/helpers.js';
import { parseEntry, serializeBody, show, stripPositions } from './helpers.js';

function entry(body: string): RawEntry {
  const { entries } = segment(`${HEADER}word\n${body}`);
  return entries[0] as RawEntry;
}

describe('parseBody', () => {
  it('joins body lines with line breaks', () => {
    const { nodes, codes } = parseEntry(entry('\t[m1]a[/m]\n\t[m2][*]b\n\t c[/*][/m]\n'));
    expect(show(nodes)).toBe('m{level=1}("a") m{level=2}(*("b" / "c"))');
    expect(codes).toEqual([]);
  });

  it('closes tags left open at the end of the entry', () => {
    const { nodes, diagnostics } = parseEntry(entry('\t[b]a\n\tb\n'));
    expect(show(nodes)).toBe('b("a" / "b")');
    expect(diagnostics).toMatchObject([{ code: 'DSL4202', position: { line: 5, column: 2 } }]);
  });

  it('returns nothing for an empty body', () => {
    expect(parseBody({ body: [] })).toEqual([]);
  });

  it('can be called again on the same entry with the same result', () => {
    const raw = entry('\t[b]a[/b] ~\n');
    expect(parseBody(raw)).toEqual(parseBody(raw));
  });
});

describe('sub-entries', () => {
  it('become nodes at their place in the parent', () => {
    const { nodes, codes } = parseEntry(
      entry('\t[m1]main[/m]\n\t@ sub one\n\t[m1]sub body[/m]\n\t@\n\t[m1]more[/m]\n'),
    );
    expect(show(nodes)).toBe(
      'm{level=1}("main") @{sub one}(m{level=1}("sub body")) m{level=1}("more")',
    );
    expect(codes).toEqual([]);
  });

  it('nest inside the tags open in the parent', () => {
    const { nodes, codes } = parseEntry(
      entry('\t[m3][*]a\n\t@ hw\n\t[m1]b\n\tc\n\t@\n\t[/*][/m]\n'),
    );
    expect(show(nodes)).toBe('m{level=3}(*("a" @{hw}(m{level=1}("b" / "c"))))');
    expect(codes).toEqual([]);
  });

  it('keep several headwords, with positions', () => {
    const { nodes } = parseEntry(entry('\t@ one\n  @   two  \n\tbody\n\t@\n'));
    const sub = nodes[0] as SubentryNode;
    expect(sub.headwords).toEqual([
      { text: 'one', position: { offset: 76, line: 5, column: 4 } },
      { text: 'two', position: { offset: 86, line: 6, column: 7 } },
    ]);
    expect(show(nodes)).toBe('@{one|two}("body")');
  });

  it('close the tags opened inside them', () => {
    const { nodes, diagnostics } = parseEntry(entry('\tx\n\t@ hw\n\t[b]a\n\t@\n\ty[/b]\n'));
    expect(show(nodes)).toBe('"x" @{hw}(b("a")) "y"');
    expect(diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL4202', 7],
      ['DSL4201', 9],
    ]);
  });

  it('cannot close tags of the parent', () => {
    const { nodes, codes } = parseEntry(entry('\t[b]x\n\t@ hw\n\ta[/b]\n\t@\n\ty[/b]\n'));
    expect(show(nodes)).toBe('b("x" @{hw}("a") "y")');
    expect(codes).toEqual(['DSL4201']);
  });

  it('process tags before the @ in the parent and closing tags after a lone @ after it', () => {
    const { nodes, codes } = parseEntry(entry('\t[m1] [b]@ sub\n\tx\n\t@[/b] [/m]\n\ty\n'));
    expect(show(nodes)).toBe('m{level=1}(b(@{sub}("x"))) "y"');
    expect(codes).toEqual([]);
  });

  it('end at the next sub-entry or at the end of the body when not closed', () => {
    const { nodes } = parseEntry(entry('\t@ a\n\tx\n\t@ b\n\t[i]y\n'));
    expect(show(nodes)).toBe('@{a}("x") @{b}(i("y"))');
  });

  it('close a text-only tag open in the parent first', () => {
    const { nodes, codes } = parseEntry(entry('\t[t]abc\n\t@ hw\n\tx\n\t@\n'));
    expect(show(nodes)).toBe('t("abc") @{hw}("x")');
    expect(codes).toEqual(['DSL4202']);
  });

  it('ignore a lone @ without an open sub-entry', () => {
    expect(show(parseEntry(entry('\ta\n\t@\n\tb\n')).nodes)).toBe('"a" / "b"');
  });

  it('get positions from the @ to the end of the closing @', () => {
    const nodes = parseBody(entry('\tx\n\t@ hw\n\ty\n\t@\n'));
    expect(nodes[1]).toMatchObject({
      type: 'subentry',
      position: { line: 6, column: 2 },
      end: { line: 8, column: 3 },
    });
  });

  it('keep segments of a headword line with a comment', () => {
    const { nodes } = parseEntry(entry('\t@ a{{c}}b\n\tx\n\t@\n'));
    const sub = nodes[0] as SubentryNode;
    expect(sub.headwords[0]?.text).toBe('ab');
    expect(sub.headwords[0]?.segments).toEqual([
      { index: 0, position: { offset: 76, line: 5, column: 4 } },
      { index: 1, position: { offset: 82, line: 5, column: 10 } },
    ]);
  });

  it('survive a round trip through serialization', () => {
    for (const body of [
      '\t[m1]main[/m]\n\t@ sub one\n\t[m1]sub body[/m]\n\t@\n\t[m1]more[/m]\n',
      '\t[m3][*]a\n\t@ hw\n\t@ hw2\n\t[m1]b\n\tc\n\t@\n\t[/*][/m]\n\tz\n',
      '\t@ a\n\tx\n\t@ b\n\t[i]y\n',
    ]) {
      const first = parseEntry(entry(body)).nodes;
      const again = parseEntry(entry(serializeBody(first))).nodes;
      expect(stripPositions(again)).toEqual(stripPositions(first));
    }
  });
});

describe('chunking', () => {
  it('gives identical ASTs whatever the chunking of the input', () => {
    const text =
      `${HEADER}a\n\t[m1][b]x {{c}}[i]y\n\t[/b]z[/i][/m]\n\t@ s{{q}}u{{r}}b\n\t[m2]~ <<link>>\n\t@\n` +
      `b\n\t[c red]𝄞\\ ^~[/c]\n\t[ref dict="d"]t[/ref]\n`;
    const reference = segment(text).entries.map((e) => parseBody(e));
    expect(reference).toHaveLength(2);
    for (const size of [1, 2, 3, 5, 7, 64]) {
      const entries = segment(text, size).entries;
      expect(
        entries.map((e) => parseBody(e)),
        `chunk size ${size}`,
      ).toEqual(reference);
    }
  });
});
