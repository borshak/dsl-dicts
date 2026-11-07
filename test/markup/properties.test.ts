import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCollectingSink, parseBody, parseMarkup } from '../../src/index.js';
import { HEADER, segment } from '../segment/helpers.js';
import { markupText } from './arbitraries.js';
import { parse, serialize, stripPositions } from './helpers.js';

const RUNS = { numRuns: 500 };

/** Diagnostics that canonical markup can still have. */
const CANONICAL_CODES = new Set([
  'DSL4101',
  'DSL4103',
  'DSL4104',
  'DSL4105',
  'DSL4106',
  'DSL4204',
  'DSL4206',
]);

describe('properties', () => {
  it('never throws, on markup-ish and on arbitrary text', () => {
    fc.assert(
      fc.property(fc.oneof(markupText, fc.string({ unit: 'binary', maxLength: 200 })), (text) => {
        parseMarkup(text, { diagnostics: createCollectingSink() });
        parseMarkup(text, { positions: false });
      }),
      RUNS,
    );
  });

  it('survives a round trip: parse(serialize(parse(x))) equals parse(x)', () => {
    fc.assert(
      fc.property(markupText, (text) => {
        const first = parse(text).nodes;
        const canonical = serialize(first);
        const again = parse(canonical);
        expect(again.nodes).toEqual(first);
        // Canonical markup is a fixed point and well-formed: what remains to report is about
        // names and attributes (unknown tags, same tag nested, attribute values), not syntax.
        expect(again.codes.filter((code) => !CANONICAL_CODES.has(code))).toEqual([]);
        expect(serialize(again.nodes)).toBe(canonical);
      }),
      RUNS,
    );
  });

  it('gives the same tree with and without positions', () => {
    fc.assert(
      fc.property(markupText, (text) => {
        expect(stripPositions(parseMarkup(text))).toEqual(parseMarkup(text, { positions: false }));
      }),
      RUNS,
    );
  });

  it('produces plain JSON data', () => {
    fc.assert(
      fc.property(markupText, (text) => {
        const nodes = parseMarkup(text);
        expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes);
        expect(structuredClone(nodes)).toEqual(nodes);
      }),
      RUNS,
    );
  });

  it('never leaves empty or adjacent text nodes', () => {
    fc.assert(
      fc.property(markupText, (text) => {
        const json = JSON.stringify(parse(text).nodes);
        expect(json).not.toContain('"text":""');
        expect(json).not.toMatch(/"type":"text","text":"(?:[^"\\]|\\.)*"\},\{"type":"text"/);
      }),
      RUNS,
    );
  });

  it('reports diagnostics in source order', () => {
    fc.assert(
      fc.property(markupText, (text) => {
        const offsets = parse(text).diagnostics.map((d) => d.position?.offset ?? -1);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
        expect(offsets.every((o) => o >= 0 && o <= text.length)).toBe(true);
      }),
      RUNS,
    );
  });

  it('parses bodies the same for any chunking', () => {
    const body = fc
      .array(
        markupText.map((t) => t.replace(/\n/g, ' ')),
        { minLength: 1, maxLength: 6 },
      )
      .map((lines) => lines.map((l) => `\t${l || 'x'}\n`).join(''));
    fc.assert(
      fc.property(body, fc.integer({ min: 1, max: 9 }), (lines, size) => {
        const text = `${HEADER}w\n${lines}`;
        const reference = segment(text).entries.map((e) => parseBody(e));
        expect(segment(text, size).entries.map((e) => parseBody(e))).toEqual(reference);
      }),
      { numRuns: 100 },
    );
  });
});
