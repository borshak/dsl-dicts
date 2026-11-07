import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCollectingSink, MAX_VARIANTS, parseHeadword } from '../../src/index.js';
import { markupText } from '../markup/arbitraries.js';
import { stripPositions } from '../markup/helpers.js';

const RUNS = { numRuns: 500 };

/** Headword-ish text: markup pieces plus braces, parentheses and escapes of them. */
const headwordText = fc
  .array(
    fc.oneof(
      { weight: 4, arbitrary: markupText.map((t) => t.replace(/\n/g, ' ')) },
      {
        weight: 4,
        arbitrary: fc.constantFrom('{', '}', '(', ')', '\\{', '\\}', '\\(', '\\)', '\\~', '^~'),
      },
    ),
    { maxLength: 12 },
  )
  .map((parts) => parts.join(''));

/** Well-formed tags, words and headword syntax, without escapes or literal brackets. */
const cleanText = fc
  .array(
    fc.constantFrom(
      '{',
      '}',
      '(',
      ')',
      '~',
      '^~',
      ' ',
      '\t',
      'ab',
      'Ж',
      '𝄞',
      "[']",
      "[/']",
      '[p]',
      '[/p]',
      '[b]',
      '[/b]',
      '[c red]',
      '[/c]',
      '[br]',
      '[foo]',
      '<<x>>',
    ),
    { maxLength: 30 },
  )
  .map((parts) => parts.join(''));

function checkForms(variants: readonly string[]): void {
  expect(variants.length).toBeLessThanOrEqual(MAX_VARIANTS);
  expect(new Set(variants).size).toBe(variants.length);
  for (const v of variants) {
    expect(v.length).toBeGreaterThan(0);
    expect(v).not.toMatch(/^[ \t]|[ \t]$|\t| {2}/);
  }
}

describe('headword properties', () => {
  it('never throws, and gives normalized, unique index forms', () => {
    fc.assert(
      fc.property(
        fc.oneof(headwordText, fc.string({ unit: 'binary', maxLength: 200 })),
        fc.option(fc.string({ maxLength: 5 }), { nil: undefined }),
        (text, tilde) => {
          const headword = parseHeadword(text, { tilde, diagnostics: createCollectingSink() });
          checkForms(headword.variants);
          expect(headword.text).not.toMatch(/^[ \t]|[ \t]$|\t| {2}/);
        },
      ),
      RUNS,
    );
  });

  it('never puts braces or tag markup into the index forms', () => {
    fc.assert(
      fc.property(cleanText, (text) => {
        const { variants } = parseHeadword(text, { tilde: 'w' });
        checkForms(variants);
        for (const v of variants) expect(v).not.toMatch(/[{}[\]<>]/);
      }),
      RUNS,
    );
  });

  it('reads escaped text literally', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 30 }), (text) => {
        const escaped = text.replace(/[\\{}()[\]~^<>@#]/g, '\\$&');
        // Only spaces and tabs are whitespace in DSL: other spaces are kept.
        const expected = text.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
        const { variants, text: plain } = parseHeadword(escaped);
        expect(variants).toEqual(expected === '' ? [] : [expected]);
        expect(plain).toBe(expected);
      }),
      RUNS,
    );
  });

  it('gives the same result with and without positions', () => {
    fc.assert(
      fc.property(headwordText, (text) => {
        expect(stripPositions(parseHeadword(text))).toEqual(
          parseHeadword(text, { positions: false }),
        );
      }),
      RUNS,
    );
  });

  it('produces plain JSON data', () => {
    fc.assert(
      fc.property(headwordText, (text) => {
        const headword = parseHeadword(text);
        expect(JSON.parse(JSON.stringify(headword))).toEqual(headword);
        expect(structuredClone(headword)).toEqual(headword);
      }),
      RUNS,
    );
  });

  it('reports diagnostics in source order, inside the headword', () => {
    fc.assert(
      fc.property(headwordText, (text) => {
        const sink = createCollectingSink();
        parseHeadword(text, { diagnostics: sink });
        const offsets = sink.diagnostics.map((d) => d.position?.offset ?? -1);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
        expect(offsets.every((o) => o >= 0 && o <= text.length)).toBe(true);
      }),
      RUNS,
    );
  });
});
