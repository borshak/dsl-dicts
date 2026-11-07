import { describe, expect, it } from 'vitest';
import { bodies, HEADER, segment } from './helpers.js';

describe('sub-entries', () => {
  it('are marked inside the parent body, in order', () => {
    const { entries, codes } = segment(
      `${HEADER}parent\n\t[m1]main[/m]\n\t@ ~ sub \n\t[m1]sub body[/m]\n\t@\n\t[m1]more[/m]\n`,
    );
    expect(bodies(entries)).toEqual([
      ['[m1]main[/m]', 'start:~ sub', '[m1]sub body[/m]', 'end:@', '[m1]more[/m]'],
    ]);
    expect(entries[0]?.body[1]).toEqual({
      kind: 'subentry-start',
      text: '@ ~ sub ',
      indent: '\t',
      position: { offset: 90, line: 6, column: 2 },
      marker: 0,
      headword: '~ sub',
    });
    expect(entries[0]?.body[3]).toMatchObject({ kind: 'subentry-end', marker: 0 });
    expect(codes).toEqual([]);
  });

  it('may have several headwords', () => {
    const { entries, codes } = segment(`${HEADER}p\n\t@ one\n  @two\n\tbody\n\t@\n`);
    expect(bodies(entries)).toEqual([['start:one', 'start:two', 'body', 'end:@']]);
    expect(codes).toEqual([]);
  });

  it('accept tags before the @ and closing tags after a lone @', () => {
    const { entries, codes } = segment(
      `${HEADER}p\n\t[m1] [b]@ sub[/b]\n\tx\n\t@[/m]\n\t @ [/c] [/m] \n`,
    );
    expect(entries[0]?.body.map((l) => [l.kind, 'marker' in l ? l.marker : -1])).toEqual([
      ['subentry-start', 8],
      ['text', -1],
      ['subentry-end', 0],
      ['subentry-end', 0],
    ]);
    expect(entries[0]?.body[0]).toMatchObject({ headword: 'sub[/b]' });
    expect(codes).toEqual(['DSL2302']);
  });

  it('are not started by an escaped or a mid-line @', () => {
    const { entries, codes } = segment(`${HEADER}p\n\t\\@ x\n\tmail@example\n\t[@] x\n\t[] @x\n`);
    expect(entries[0]?.body.every((l) => l.kind === 'text')).toBe(true);
    expect(codes).toEqual([]);
  });

  it('are not recognized in headword lines', () => {
    const { entries } = segment(`${HEADER}@ head\n\tbody\n`);
    expect(entries[0]?.headwords[0]?.text).toBe('@ head');
  });

  it('report a sub-entry left open at the end of the entry', () => {
    const { entries, diagnostics } = segment(`${HEADER}p\n\t@ sub\n\tx\nq\n\ty\n`);
    expect(entries).toHaveLength(2);
    expect(diagnostics).toMatchObject([{ code: 'DSL2301', position: { line: 5, column: 2 } }]);
  });

  it('report a sub-entry implicitly closed by the next one', () => {
    const { entries, diagnostics } = segment(`${HEADER}p\n\t@ a\n\tx\n\t@ b\n\ty\n\t@\n`);
    expect(bodies(entries)).toEqual([['start:a', 'x', 'start:b', 'y', 'end:@']]);
    expect(diagnostics).toMatchObject([{ code: 'DSL2301', position: { line: 5 } }]);
  });

  it('report a lone @ outside a sub-entry', () => {
    const { diagnostics } = segment(`${HEADER}p\n\tx\n\t@\n\t@ a\n\t@\n\t@\n`);
    expect(diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL2302', 6],
      ['DSL2302', 9],
    ]);
  });

  it('report an entry ending at the end of input with an open sub-entry', () => {
    expect(segment(`${HEADER}p\n\t@ a\n\tx`).codes).toEqual(['DSL2301']);
  });
});
