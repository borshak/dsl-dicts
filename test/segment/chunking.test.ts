import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encode } from '../decode/helpers.js';
import { checkPositions, HEADER, type Segmented, segment, segmentAsync } from './helpers.js';

/** Synthetic inputs exercising every rule, including the problem cases. */
const FIXTURES: Readonly<Record<string, string>> = {
  plain: `${HEADER}\none\n\t[m1]a[/m]\ntwo\nthree\n  b\n`,
  'blank lines': `\n${HEADER}\n\na\n\n\tx\n\n\ty\n\nb\n\n`,
  comments: `{{ multi\nline }}\n${HEADER}a {{ x\nb\n}} c\n\t{{q}}x{{r}}y\n\tz {{ open\n`,
  escapes: `${HEADER}a\\{{b}}\n\t\\\\{{c}}d\n\t{{\\}}e\n`,
  subentries: `${HEADER}p\n\t@ a\n\t@ b\n\tx\n\t@\n\t@\n\t[m1]@ c\n\ty\nq\n\tz\n`,
  stray: `${HEADER}\torphan\n#X\na\n#Y\n\tb\nlast`,
  'no header': 'a\n\tb\n',
  unicode: `${HEADER}привет 𝄞\n\t[m1]😀 日本語{{ 注 }}ж[/m]\n`,
};

function strip(result: Segmented) {
  return { ...result, diagnostics: result.diagnostics.map(({ cause: _c, ...rest }) => rest) };
}

describe('chunking invariance', () => {
  for (const [name, text] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const reference = segment(text);
      expect(checkPositions(text, reference.entries)).toBeUndefined();
      for (const size of [1, 2, 3, 7, 65536]) {
        expect(segment(text, size), `chunk size ${size}`).toEqual(reference);
        const bytes = encode(text, 'utf-16le', true);
        const async = await segmentAsync(bytes, { chunkSize: size });
        expect(strip(async), `async, chunk size ${size}`).toEqual(strip(reference));
      }
    });
  }

  it('does not depend on how a large input is chunked', () => {
    const cards = Array.from({ length: 3000 }, (_, i) => `w${i}\n\t[m1]{{c}}body ${i}[/m]\n`);
    const text = HEADER + cards.join('');
    const reference = segment(text);
    expect(reference.entries).toHaveLength(3000);
    for (const sizes of [[65536], [4096, 1, 333], [100_000]]) {
      expect(segment(text, sizes)).toEqual(reference);
    }
  });
});

describe('properties', () => {
  /** Text built from the characters that matter to the segmenter. */
  const dslText = fc
    .array(
      fc.oneof(
        fc.constantFrom('\n', '\r\n', '\r', ' ', '\t', '{{', '}}', '{', '}', '\\', '@', '#'),
        fc.constantFrom('[m1]', '[/m]', '#NAME "x"', 'word', '𝄞', '﻿'),
        fc.string({ unit: 'binary', maxLength: 6 }),
      ),
      { maxLength: 120 },
    )
    .map((parts) => parts.join(''));
  const sizes = fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 6 });

  it('never throws and gives the same result for any chunking', () => {
    fc.assert(
      fc.property(dslText, sizes, (text, chunks) => {
        const reference = segment(text);
        expect(segment(text, chunks)).toEqual(reference);
      }),
    );
  });

  it('maps every character back to the source', () => {
    fc.assert(
      fc.property(dslText, (text) => {
        // Positions refer to the normalized text, as produced by decodeDsl.
        let normalized = text.replace(/\r\n?/g, '\n');
        if (normalized.startsWith('﻿')) normalized = normalized.slice(1);
        expect(checkPositions(normalized, segment(text).entries)).toBeUndefined();
      }),
    );
  });

  it('keeps every line of entries meaningful', () => {
    fc.assert(
      fc.property(dslText, (text) => {
        for (const entry of segment(text).entries) {
          expect(entry.headwords.length).toBeGreaterThan(0);
          for (const line of entry.headwords) expect(line.text).toMatch(/^[^ \t#]/);
          for (const line of entry.body) {
            expect(line.text).toMatch(/^[^ \t]/);
            expect(line.indent).toMatch(/^[ \t]+$/);
            expect(line.text).not.toMatch(/\n/);
          }
        }
      }),
    );
  });

  it('never throws through segmentDsl on arbitrary bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), sizes, async (bytes, chunkSizes) => {
        const size = chunkSizes[0] as number;
        await segmentAsync(bytes, { chunkSize: size });
      }),
      { numRuns: 50 },
    );
  });
});
