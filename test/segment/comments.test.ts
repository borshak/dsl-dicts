import { describe, expect, it } from 'vitest';
import { positionInLine } from '../../src/index.js';
import { bodies, checkPositions, HEADER, headwords, segment } from './helpers.js';

describe('comments', () => {
  it('are removed within a line', () => {
    const text = `${HEADER}temperature {{ headword }}\n\t{{a}}temp{{b}}era{{c}}ture {{ entry }}\n`;
    const { entries, codes } = segment(text);
    expect(headwords(entries)).toEqual([['temperature ']]);
    expect(bodies(entries)).toEqual([['temperature ']]);
    expect(codes).toEqual([]);
    expect(checkPositions(text, entries)).toBeUndefined();
  });

  it('record segments only for non-contiguous text', () => {
    const text = `${HEADER}word {{ x }}\n\t{{c}}ab{{d}}cd\n`;
    const [entry] = segment(text).entries;
    expect(entry?.headwords[0]).not.toHaveProperty('segments');
    const body = entry?.body[0];
    expect(body).toMatchObject({ text: 'abcd', indent: '\t', position: { line: 5, column: 7 } });
    expect(body?.segments).toEqual([
      { index: 0, position: { offset: 87, line: 5, column: 7 } },
      { index: 2, position: { offset: 94, line: 5, column: 14 } },
    ]);
    expect(body && positionInLine(body, 3)).toEqual({ offset: 95, line: 5, column: 15 });
    expect(body && positionInLine(body, 4)).toEqual({ offset: 96, line: 5, column: 16 });
    expect(checkPositions(text, segment(text).entries)).toBeUndefined();
  });

  it('may span lines, joining the text around them and swallowing headwords', () => {
    const text = `${HEADER}a {{ x\nswallowed\n\tswallowed\n}} b\n\tbody {{\n}}more\nc\n\td\n`;
    const { entries, codes } = segment(text);
    expect(headwords(entries)).toEqual([['a  b'], ['c']]);
    expect(bodies(entries)).toEqual([['body more'], ['d']]);
    expect(entries[0]?.headwords[0]?.segments).toEqual([
      { index: 0, position: { offset: 68, line: 4, column: 1 } },
      { index: 2, position: { offset: 98, line: 7, column: 3 } },
    ]);
    expect(entries[0]?.end).toMatchObject({ line: 9, column: 7 });
    expect(codes).toEqual([]);
    expect(checkPositions(text, entries)).toBeUndefined();
  });

  it('make nothing special inside them, not even a backslash', () => {
    const { entries } = segment(`${HEADER}a{{\\}}b\n\t{{ [b] @ # \\{{ }}x\n`);
    expect(headwords(entries)).toEqual([['ab']]);
    expect(bodies(entries)).toEqual([['x']]);
  });

  it('do not start at an escaped brace', () => {
    const { entries } = segment(`${HEADER}a\\{{b}}\n\tc\\\\{{d}}e\\\\\\{{f\n\t\\{{{g}}\n`);
    expect(headwords(entries)).toEqual([['a\\{{b}}']]);
    expect(bodies(entries)).toEqual([['c\\\\e\\\\\\{{f', '\\{']]);
  });

  it('pair the leftmost braces', () => {
    const { entries } = segment(`${HEADER}a{{{b}}}c\n\tx\n`);
    expect(headwords(entries)).toEqual([['a}c']]);
  });

  it('drop lines left with only spaces, silently', () => {
    const text = `${HEADER}{{c}}\na\n{{c}}\n  {{c}}\n\tx\n{{c}}\n\t{{c}}\n\ty\n{{c}}\nb\n\tz\n`;
    const { entries, codes } = segment(text);
    expect(headwords(entries)).toEqual([['a'], ['b']]);
    expect(bodies(entries)).toEqual([['x', 'y'], ['z']]);
    expect(codes).toEqual([]);
  });

  it('decide the line class by what remains', () => {
    const { entries } = segment(`${HEADER}{{c}}head\n{{c}}\tbody\n`);
    expect(headwords(entries)).toEqual([['head']]);
    expect(bodies(entries)).toEqual([['body']]);
  });

  it('that are not closed swallow the rest of the input', () => {
    const text = `${HEADER}a\n\tx {{ open\nb\n\ty\n`;
    const { entries, diagnostics } = segment(text);
    expect(headwords(entries)).toEqual([['a']]);
    expect(bodies(entries)).toEqual([['x ']]);
    expect(diagnostics).toMatchObject([
      { code: 'DSL2101', severity: 'error', position: { line: 5, column: 4 } },
    ]);
    expect(entries[0]?.end).toMatchObject({ line: 7, column: 3 });
  });

  it('that are not closed may leave an empty line, which is dropped', () => {
    const { entries, codes } = segment(`${HEADER}a\n\tx\n{{ open`);
    expect(bodies(entries)).toEqual([['x']]);
    expect(codes).toEqual(['DSL2101']);
  });
});
