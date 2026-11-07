import { describe, expect, it } from 'vitest';
import {
  createCollectingSink,
  type Headword,
  parseBody,
  parseHeadwords,
  type RawEntry,
  type SubentryNode,
} from '../../src/index.js';
import { show } from '../markup/helpers.js';
import { HEADER, segment } from '../segment/helpers.js';

function entry(text: string): RawEntry {
  return segment(`${HEADER}${text}`).entries[0] as RawEntry;
}

function subentries(nodes: ReturnType<typeof parseBody>): SubentryNode[] {
  return nodes.filter((n): n is SubentryNode => n.type === 'subentry');
}

describe('parseHeadwords', () => {
  it('parses every headword line of an entry, with positions', () => {
    const raw = entry("(пре)вращать(ся)\n{[']}a{[/']}b  \n\tbody\n");
    const headwords = parseHeadwords(raw);
    expect(headwords.map((h) => h.variants)).toEqual([
      ['вращать', 'вращаться', 'превращать', 'превращаться'],
      ['ab'],
    ]);
    expect(headwords[1]).toMatchObject({
      raw: "{[']}a{[/']}b",
      position: { offset: 85, line: 5, column: 1 },
      end: { offset: 98, line: 5, column: 14 },
    });
    expect(headwords[1]?.display[0]).toMatchObject({
      type: 'tag',
      name: "'",
      position: { line: 5, column: 2 },
      end: { line: 5, column: 12 },
    });
  });

  it('substitutes ~ in later headwords with the first form of the first one', () => {
    const sink = createCollectingSink();
    const headwords = parseHeadwords(entry('colo(u)r\n~ code\n^~s\n\tbody\n'), {
      positions: false,
      diagnostics: sink,
    });
    expect(headwords.map((h) => h.variants)).toEqual([
      ['color', 'colour'],
      ['color code'],
      ['Colors'],
    ]);
    expect(headwords[1]?.text).toBe('color code');
    expect(show(headwords[1]?.display ?? [])).toBe('~ " code"');
    expect(sink.diagnostics).toEqual([]);
  });

  it('reports a ~ in the first headword, in source order with other diagnostics', () => {
    const sink = createCollectingSink();
    parseHeadwords(entry('a~\nb)\n{c\n\tbody\n'), { diagnostics: sink });
    expect(sink.diagnostics.map((d) => [d.code, d.position?.line, d.position?.column])).toEqual([
      ['DSL3102', 4, 2],
      ['DSL3004', 5, 2],
      ['DSL3001', 6, 1],
      ['DSL3201', 6, 1],
    ]);
  });

  it('removes comments before parsing', () => {
    const [headword] = parseHeadwords(entry('a{{x}}(b){{ y }}\n\tbody\n'));
    expect(headword?.raw).toBe('a(b)');
    expect(headword?.variants).toEqual(['a', 'ab']);
    // Right after the ), before the trailing comment.
    expect(headword?.end).toMatchObject({ line: 4, column: 10 });
  });
});

describe('sub-entry headwords', () => {
  const body = "\t[m1]x[/m]\n\t@ ~ out\n\t@ ^~ (up)\n\t@ {to }~{[']}s{[/']}\n\t[m1]y[/m]\n\t@\n";

  it('are parsed headwords, with ~ standing for the first form of the entry headword', () => {
    const sink = createCollectingSink();
    const [sub] = subentries(
      parseBody(entry(`go(es)\n${body}`), { positions: false, diagnostics: sink }),
    );
    expect(sub?.headwords.map((h) => h.variants)).toEqual([['go out'], ['Go', 'Go up'], ['gos']]);
    expect(sub?.headwords.map((h) => h.text)).toEqual(['go out', 'Go (up)', 'to gos']);
    expect(show(sub?.headwords[2]?.display ?? [])).toBe('"to " ~ \'("s")');
    expect(sink.diagnostics).toEqual([]);
  });

  it('use the parent headwords whether raw or parsed', () => {
    const raw = entry(`Go\nwent\n${body}`);
    const fromRaw = parseBody(raw);
    const fromParsed = parseBody({ headwords: parseHeadwords(raw), body: raw.body });
    expect(fromParsed).toEqual(fromRaw);
    const [sub] = subentries(fromRaw);
    expect(sub?.headwords[1]?.variants).toEqual(['go', 'go up']);
  });

  it('keep ~ as text without parent headwords', () => {
    const raw = entry(`go\n${body}`);
    const sink = createCollectingSink();
    const [sub] = subentries(parseBody({ body: raw.body }, { diagnostics: sink }));
    expect(sub?.headwords[0]?.variants).toEqual(['~ out']);
    expect(sink.diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL3102', 6],
      ['DSL3102', 7],
      ['DSL3102', 8],
    ]);
  });

  it('report their own problems, in source order with the body', () => {
    const sink = createCollectingSink();
    parseBody(entry('w\n\t[b]a\n\t@ x(y\n\tz\n\t@\n'), { diagnostics: sink });
    expect(sink.diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL4202', 5],
      ['DSL3003', 6],
    ]);
  });

  it('have positions in the body line', () => {
    const [sub] = subentries(parseBody(entry('w\n\t@  a(b)\n\tz\n\t@\n')));
    const headword = sub?.headwords[0] as Headword;
    expect(headword.position).toMatchObject({ line: 5, column: 5 });
    expect(headword.end).toMatchObject({ line: 5, column: 9 });
  });
});
