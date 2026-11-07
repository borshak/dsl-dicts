import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Article,
  type ArticleOptions,
  article,
  DEFAULT_EXTRACTORS,
  type Sense,
} from '../../src/article/index.js';
import { createDictionaryContext, parseDsl, setupPlugin } from '../../src/index.js';
import { markupText } from '../markup/arbitraries.js';
import { collect, deepFreeze, HEADER } from './helpers.js';

const RUNS = { numRuns: 200 };

/** Pieces of the markup of real dictionaries, for bodies that look like theirs. */
const PIECES = [
  '[m1]',
  '[m2]',
  '[m3]',
  '[/m]',
  '1) ',
  '2. ',
  'а) ',
  '[b]I[/b] ',
  '[b]1.[/b] ',
  '[trn]',
  '[/trn]',
  '[ex]',
  '[/ex]',
  '[lang id=1033]',
  '[lang name="German"]',
  '[/lang]',
  '[com]',
  '[/com]',
  '[p]',
  '[/p]',
  '[*]',
  '[/*]',
  '[i]',
  '[/i]',
  '[c]',
  '[/c]',
  '[!trs]',
  '[/!trs]',
  '[t]',
  '[/t]',
  "[']",
  "[/']",
  ' — ',
  ' - ',
  ' ≈ ',
  '; ',
  ', ',
  '(',
  ')',
  '\\[',
  '\\]',
  '•',
  'Syn:',
  'см. ',
  '= ',
  '<<link>>',
  '[ref]ref[/ref]',
  '[ref dict="d"]',
  '[/ref]',
  '[url]u[/url]',
  '[s]a.wav[/s]',
  '[s]p.jpg[/s]',
  '~',
  '^~',
  'word',
  'слово',
  ' ',
];

const piecesLine = fc.array(fc.constantFrom(...PIECES), { maxLength: 14 }).map((p) => p.join(''));

/** A body line: dictionary-like pieces, arbitrary markup, or a sub-entry marker. */
const bodyLine = fc.oneof(
  { weight: 6, arbitrary: piecesLine.map((text) => `\t${text}`) },
  { weight: 3, arbitrary: markupText.map((text) => `\t${text.replace(/\n/g, ' ')}`) },
  { weight: 1, arbitrary: piecesLine.map((text) => `\t@ ${text.replace(/\n/g, ' ')}`) },
  { weight: 1, arbitrary: fc.constant('\t@') },
);

const dictionary = fc
  .array(
    fc.record({
      headwords: fc.array(
        markupText.map((text) => text.replace(/\n/g, ' ').replace(/^[\s#@]+/, '') || 'w'),
        { minLength: 1, maxLength: 2 },
      ),
      body: fc.array(bodyLine, { maxLength: 8 }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map(
    (entries) =>
      `${HEADER}${entries.map((e) => [...e.headwords, ...e.body].join('\n')).join('\n')}\n`,
  );

const options: fc.Arbitrary<ArticleOptions> = fc.record(
  {
    labels: fc.constantFrom('expand' as const, 'keep' as const),
    stress: fc.constantFrom('none' as const, 'combining' as const),
    secondary: fc.boolean(),
    splitTranslations: fc.boolean(),
    kind: fc.constantFrom(...Object.keys(DEFAULT_EXTRACTORS)),
  },
  { requiredKeys: [] },
);

/** Checks the invariants of an article: plain data, no undefined, no empty strings. */
function check(a: Article): void {
  expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  const visit = (value: unknown): void => {
    expect(value).not.toBeUndefined();
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  visit(a);
  if (a.notes !== undefined) expect(a.notes.length).toBeGreaterThan(0);
  const senses = (list: readonly Sense[]): void => {
    for (const s of list) {
      for (const t of s.translations) expect(t.trim()).not.toBe('');
      if (s.notes !== undefined) expect(s.notes.length).toBeGreaterThan(0);
      for (const n of s.notes ?? []) expect(n.trim()).not.toBe('');
      senses(s.senses);
    }
  };
  senses(a.senses);
  for (const n of a.notes ?? []) expect(n.trim()).not.toBe('');
  a.subentries.forEach(check);
}

describe('article plugin, on arbitrary input', () => {
  it('never throws, never mutates frozen entries, and gives plain data', async () => {
    await fc.assert(
      fc.asyncProperty(dictionary, options, async (text, use) => {
        const dict = parseDsl(text, { positions: false });
        const entries = (await collect(dict.entries())).map(deepFreeze);
        const context = createDictionaryContext({
          header: await dict.header,
          abbreviations: new Map([['n', 'noun']]),
        });
        const transform = setupPlugin(article, context, use);
        for (const entry of entries) check(transform(entry));
      }),
      RUNS,
    );
  });

  it('gives the same articles through parseDsl as by hand, whatever the chunks', async () => {
    await fc.assert(
      fc.asyncProperty(dictionary, async (text) => {
        const dict = parseDsl(text, { positions: false });
        const entries = await collect(dict.entries());
        const context = createDictionaryContext({ header: await dict.header });
        const viaParse = await collect(
          parseDsl(text, { positions: false, chunkSize: 7 }).entries({ plugin: article }),
        );
        expect(viaParse).toEqual(entries.map(setupPlugin(article, context)));
      }),
      { numRuns: 50 },
    );
  });
});
