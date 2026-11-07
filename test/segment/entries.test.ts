import { describe, expect, it } from 'vitest';
import { DslError } from '../../src/index.js';
import { createSegmenter } from '../../src/segment/segmenter.js';
import { bodies, checkPositions, HEADER, headwords, segment } from './helpers.js';

describe('entries', () => {
  it('splits headwords and indented bodies', () => {
    const text = `${HEADER}\none\n\t[m1]first[/m]\n  second\ntwo\n x\n`;
    const { entries, codes } = segment(text);
    expect(headwords(entries)).toEqual([['one'], ['two']]);
    expect(bodies(entries)).toEqual([['[m1]first[/m]', 'second'], ['x']]);
    expect(entries[0]?.body.map((l) => l.indent)).toEqual(['\t', '  ']);
    expect(codes).toEqual([]);
    expect(checkPositions(text, entries)).toBeUndefined();
  });

  it('shares one body between consecutive headwords', () => {
    const { entries, codes } = segment(`${HEADER}we\nwo\nwa\n\tbody\nthey\n\tthem\n`);
    expect(headwords(entries)).toEqual([['we', 'wo', 'wa'], ['they']]);
    expect(bodies(entries)).toEqual([['body'], ['them']]);
    expect(codes).toEqual([]);
  });

  it('records positions of entries, lines and the entry end', () => {
    const text = `${HEADER}one\n\t  body\n`;
    const [entry] = segment(text).entries;
    expect(entry?.position).toEqual({ offset: 68, line: 4, column: 1 });
    expect(entry?.headwords[0]?.position).toBe(entry?.position);
    expect(entry?.body[0]).toEqual({
      kind: 'text',
      text: 'body',
      indent: '\t  ',
      position: { offset: 75, line: 5, column: 4 },
    });
    expect(entry?.end).toEqual({ offset: 79, line: 5, column: 8 });
  });

  it('keeps trailing spaces and markup untouched', () => {
    const { entries } = segment(`${HEADER}word \\{x\\} \n\t[b]a[/b]  \n`);
    expect(headwords(entries)).toEqual([['word \\{x\\} ']]);
    expect(bodies(entries)).toEqual([['[b]a[/b]  ']]);
  });

  it('returns fresh plain-data objects for every entry (legacy bug B1)', () => {
    const { entries } = segment(`${HEADER}a\nb\n\tx\nc\n\ty\n`);
    expect(entries[0]).not.toBe(entries[1]);
    expect(entries[0]?.headwords).not.toBe(entries[1]?.headwords);
    expect(JSON.parse(JSON.stringify(entries))).toEqual(entries);
    for (const entry of entries) {
      expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
    }
  });

  it('emits a last entry without a body (legacy bug B5)', () => {
    const { entries, diagnostics } = segment(`${HEADER}a\n\tx\nlast\nlast2`);
    expect(headwords(entries)).toEqual([['a'], ['last', 'last2']]);
    expect(entries[1]?.body).toEqual([]);
    expect(diagnostics).toMatchObject([
      { code: 'DSL2204', severity: 'warning', position: { line: 7, column: 1 } },
    ]);
  });

  it('handles a last line without a newline', () => {
    const text = `${HEADER}a\n\tx`;
    const { entries, codes } = segment(text);
    expect(bodies(entries)).toEqual([['x']]);
    expect(entries[0]?.end).toMatchObject({ line: 5, column: 3 });
    expect(codes).toEqual([]);
  });

  it('accepts raw text with CRLF, CR and a BOM, like decodeDsl', () => {
    const lf = segment(`${HEADER}a\n\tx\nb\n\ty\n`);
    const crlf = segment(`﻿${HEADER.replaceAll('\n', '\r\n')}a\r\n\tx\rb\r\n\ty\r\n`, 3);
    expect(crlf).toEqual(lf);
  });

  it('works without a header and with an empty input', () => {
    expect(segment('').entries).toEqual([]);
    expect(segment('').codes).toEqual(['DSL2001', 'DSL2001', 'DSL2001']);
    expect(headwords(segment('a\n\tb\n').entries)).toEqual([['a']]);
  });

  it('rejects push after end', () => {
    const segmenter = createSegmenter();
    segmenter.end();
    expect(segmenter.end()).toEqual([]);
    expect(() => segmenter.push('x')).toThrow(DslError);
  });
});

describe('blank lines', () => {
  it('are silent between entries and in the preamble', () => {
    const { entries, codes } = segment(`\n${HEADER}\n\n\na\n\tx\n\n \n\t\nb\n\ty\n\n`);
    expect(headwords(entries)).toEqual([['a'], ['b']]);
    expect(codes).toEqual([]);
  });

  it('inside a body are skipped with a warning, and the body goes on ("orphan string")', () => {
    const { entries, diagnostics } = segment(`${HEADER}a\n\tx\n\n\t\n\ty\nb\n\tz\n`);
    expect(bodies(entries)).toEqual([['x', 'y'], ['z']]);
    expect(diagnostics).toMatchObject([{ code: 'DSL2203', position: { line: 6, column: 1 } }]);
  });

  it('between headwords merge them, with a warning', () => {
    const { entries, diagnostics } = segment(`${HEADER}a\n\nb\n\tx\n`);
    expect(headwords(entries)).toEqual([['a', 'b']]);
    expect(diagnostics).toMatchObject([{ code: 'DSL2202', position: { line: 5 } }]);
  });

  it('between headwords and the body are skipped, with a warning', () => {
    const { entries, codes } = segment(`${HEADER}a\n\n\n\tx\n`);
    expect(bodies(entries)).toEqual([['x']]);
    expect(codes).toEqual(['DSL2202']);
  });

  it('after the last headword at the end of input only report the missing body', () => {
    expect(segment(`${HEADER}a\n\n\n`).codes).toEqual(['DSL2204']);
  });
});

describe('stray lines', () => {
  it('ignores indented lines before the first headword', () => {
    const { entries, diagnostics } = segment(`${HEADER}\tlost\n\nhead\n\tbody\n`);
    expect(headwords(entries)).toEqual([['head']]);
    expect(diagnostics).toMatchObject([{ code: 'DSL2201', position: { line: 4, column: 1 } }]);
  });

  it('ignores # lines after the header, wherever they are', () => {
    const text = `${HEADER}a\n#X\n\tb\n#Y\nc\n\td\n\\#e\n\tf\n`;
    const { entries, diagnostics, header } = segment(text);
    expect(header?.directives.map((d) => d.name)).toEqual([
      'NAME',
      'INDEX_LANGUAGE',
      'CONTENTS_LANGUAGE',
    ]);
    expect(headwords(entries)).toEqual([['a'], ['c'], ['\\#e']]);
    expect(bodies(entries)).toEqual([['b'], ['d'], ['f']]);
    expect(diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL2006', 5],
      ['DSL2006', 7],
    ]);
  });

  it('ends the preamble at an indented line', () => {
    const { header, codes } = segment(`${HEADER}\tx\n#LATE "y"\n`);
    expect(header?.directives).toHaveLength(3);
    expect(codes).toEqual(['DSL2201', 'DSL2006']);
  });
});
