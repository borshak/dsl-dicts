import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDictionaryContext, parseDsl, setupPlugin } from '../../src/index.js';
import { plainText, searchText } from '../../src/plugins/index.js';
import { markupText } from '../markup/arbitraries.js';
import { collect, deepFreeze, HEADER } from '../plugin/helpers.js';

const RUNS = { numRuns: 200 };

/** A body line: markup, or a sub-entry marker. */
const bodyLine = fc.oneof(
  { weight: 5, arbitrary: markupText.map((text) => `\t${text.replace(/\n/g, ' ')}`) },
  { weight: 1, arbitrary: markupText.map((text) => `\t@ ${text.replace(/\n/g, ' ')}`) },
  { weight: 1, arbitrary: fc.constant('\t@') },
);

/** A dictionary of a few entries with arbitrary headwords and bodies. */
const dictionary = fc
  .array(
    fc.record({
      headwords: fc.array(
        markupText.map((text) => text.replace(/\n/g, ' ').replace(/^[\s#@]+/, '') || 'w'),
        { minLength: 1, maxLength: 3 },
      ),
      body: fc.array(bodyLine, { minLength: 1, maxLength: 6 }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map(
    (entries) =>
      `${HEADER}${entries.map((e) => [...e.headwords, ...e.body].join('\n')).join('\n')}\n`,
  );

const options = fc.record(
  {
    indent: fc.constantFrom('', '  '),
    media: fc.boolean(),
    secondary: fc.boolean(),
    unindexed: fc.boolean(),
    labels: fc.boolean(),
    subentries: fc.boolean(),
    expandLabels: fc.boolean(),
  },
  { requiredKeys: [] },
);

describe('built-in plugins, on arbitrary input', () => {
  it('never throw, never mutate frozen entries, and give JSON-serializable output', async () => {
    await fc.assert(
      fc.asyncProperty(dictionary, options, async (text, plainOptions) => {
        const entries = (await collect(parseDsl(text).entries())).map(deepFreeze);
        const context = createDictionaryContext({ abbreviations: new Map([['n', 'noun']]) });
        const toPlain = setupPlugin(plainText, context, plainOptions);
        const toSearch = setupPlugin(searchText, context, {
          secondary: plainOptions.secondary,
          subentries: plainOptions.subentries,
        });
        for (const entry of entries) {
          const plain = toPlain(entry);
          const search = toSearch(entry);
          for (const out of [plain, search]) {
            expect(JSON.parse(JSON.stringify(out))).toEqual(out);
            expect(out.text).not.toMatch(/^\n|\n$|\n\n/);
          }
          expect(plain.headwords.every((h) => typeof h === 'string')).toBe(true);
          expect(search.forms.every((h) => typeof h === 'string')).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('give the same output through parseDsl as by hand', async () => {
    await fc.assert(
      fc.asyncProperty(dictionary, async (text) => {
        const context = createDictionaryContext();
        const entries = await collect(parseDsl(text, { positions: false }).entries());
        const viaParse = await collect(
          parseDsl(text, { positions: false, chunkSize: 7 }).entries({ plugin: searchText }),
        );
        expect(viaParse).toEqual(entries.map(setupPlugin(searchText, context)));
      }),
      { numRuns: 50 },
    );
  });
});
