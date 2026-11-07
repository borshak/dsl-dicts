/**
 * The documentation examples that use the runtime-neutral core only: they run in Node.js and
 * in the browser. Their source is the documentation's: see `sync.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { parseDsl } from '../../src/index.js';
import { EN_DE, latin1, OLD_DE } from './fixtures.js';
import { blockOf, captureLog, collect } from './helpers.js';

const log = captureLog();

// Bundler-level imports instead of node:fs, so the test also runs in a browser.
const files = import.meta.glob<string>(
  ['../../docs/plugins.md', '../fixtures/legacy/basic_en-ru.dsl'],
  { query: '?raw', import: 'default', eager: true },
);
const file = (path: string): string => {
  const text = files[path];
  if (text === undefined) throw new Error(`Missing ${path}`);
  return text;
};

describe('README', () => {
  it('quick start in the browser', async () => {
    const { listEntries } = await import('./examples/readme-browser.js');
    const file = new File([EN_DE], 'en-de.dsl');
    expect(await listEntries(file)).toEqual([
      'cat\n1) n Katze\na black cat — eine schwarze Katze\n2) coll. Kerl; Typ',
      'colo(u)r\nn Farbe\na bright color — eine helle Farbe',
    ]);
  });

  it('the AST', async () => {
    await import('./examples/readme-ast.js');
    expect(log.calls()).toEqual([
      ['colo(u)r', ['color', 'colour']],
      ['tag', 'm'],
      ['tag', 'p'],
      ['tag', 'trn'],
      ['link', [expect.objectContaining({ type: 'text', text: 'hue' })]],
    ]);
  });

  it('diagnostics and strict mode', async () => {
    await import('./examples/readme-diagnostics.js');
    expect(log.calls()).toEqual([
      ['cat'],
      [expect.stringMatching(/^6:23 warning DSL4202 /)],
      [{ DSL4202: 1 }],
      ['DSL4202', 6],
    ]);
  });

  it('streaming', async () => {
    const { countEntries } = await import('./examples/readme-streaming.js');
    expect(await countEntries(new Blob([latin1(OLD_DE)]))).toBe(2);
  });

  it('writing a plugin', async () => {
    await import('./examples/readme-plugin.js');
    expect(log.calls()).toEqual([['cat = n Katze']]);
  });
});

describe('docs/ast.md', () => {
  it('headwords', async () => {
    await import('./examples/ast-headword.js');
    expect(log.calls()).toEqual([
      [[{ type: 'text', text: 'to colo(u)r(s)' }]],
      ['to colo(u)r(s)'],
      [['color', 'colors', 'colour', 'colours']],
    ]);
  });

  it('a renderer that skips what it does not know', async () => {
    const { toHtml } = await import('./examples/ast-html.js');
    const [entry] = await collect(parseDsl(EN_DE).entries());
    expect(toHtml(entry?.body ?? [], 'cat')).toBe(
      '<p class="m1">1) n Katze</p><p class="m2">a black cat — eine schwarze Katze</p>' +
        '<p class="m1">2) coll. Kerl; Typ</p>',
    );
    expect(
      toHtml(
        [
          { type: 'text', text: 'a<b' },
          { type: 'future', text: 'x' } as never,
          { type: 'tag', name: 'b', attrs: {}, children: [{ type: 'tilde', flipCase: false }] },
        ],
        '~',
      ),
    ).toBe('a&#60;b<b>~</b>');
  });

  it('walking an entry', async () => {
    const { linksOf } = await import('./examples/ast-walk-entry.js');
    const text = `${EN_DE.slice(0, EN_DE.indexOf('cat'))}hue\n\tsee <<colo(u)r>>, [ref]~ (tint)[/ref]\n`;
    const [entry] = await collect(parseDsl(text).entries());
    expect(entry && linksOf(entry)).toEqual(['colo(u)r', '~ (tint)']);
  });
});

describe('docs/plugins.md', () => {
  it('the contract', async () => {
    await import('./examples/plugin-contract.js');
    expect(log.calls()).toEqual([
      [{ headword: 'cat', translations: ['Katze'] }],
      [{ headword: 'dog', translations: [] }],
      [['translations/none translations translations: The entry has no translation.']],
    ]);
  });

  it('an asynchronous factory', async () => {
    const { createFrequencyPlugin } = await import('./examples/plugin-async-factory.js');
    const frequency = await createFrequencyPlugin(async () => 'the\ncolour\ncat');
    expect(await collect(parseDsl(EN_DE).entries({ plugin: frequency }))).toEqual([
      { headword: 'cat', rank: 3 },
      { headword: 'colo(u)r', rank: 2 },
    ]);
  });

  it('a plugin set up by hand', async () => {
    await import('./examples/plugin-by-hand.js');
    expect(log.calls()).toEqual([[{ headwords: ['dog'], text: '  Hund' }]]);
  });

  it('the built-in plugins', async () => {
    await import('./examples/plugins-builtin.js');
    expect(log.calls()).toEqual([
      [
        {
          headwords: ['colo(u)r'],
          text: '  noun Farbe (of light)\n    a bright color — eine helle Farbe',
        },
      ],
      [
        {
          forms: ['color', 'colour'],
          text: 'Farbe\n(of light)\na bright color — eine helle Farbe',
        },
      ],
    ]);
  });

  it('the article plugin', async () => {
    await import('./examples/article-basic.js');
    const printed = log.calls().map(([json]) => JSON.parse(json as string));
    expect(printed).toEqual([
      JSON.parse(blockOf(file('../../docs/plugins.md'), 'article-basic-output')),
    ]);
  });

  it('a customized article plugin', async () => {
    await import('./examples/article-custom.js');
    expect(log.calls()).toEqual([[[{ kind: 'my-family', senses: 1, notes: undefined }]]]);
  });
});

describe('MIGRATION.md', () => {
  it('rebuilds the 1.x phrases', async () => {
    const { toLegacyPhrases } = await import('./examples/migration-legacy.js');
    const { article } = await import('../../src/article/index.js');
    const dict = parseDsl(file('../fixtures/legacy/basic_en-ru.dsl'));
    const header = await dict.header;
    const options = { splitTranslations: false };
    const phrases = [];
    for await (const entry of dict.entries({ plugin: article, options })) {
      phrases.push(...toLegacyPhrases(entry, header));
    }
    expect(phrases.map((p) => p.phrase)).toEqual(['automatic', 'extra', 'money', 'province']);
    const [automatic] = phrases;
    expect(automatic?.transcription).toBe("ˌɔːtə'mætɪk");
    expect(automatic?.explanations.slice(0, 2)).toEqual([
      { translations: ['автоматический, автоматизированный'] },
      {
        translations: ['машинальный, непроизвольный'],
        examples: [
          {
            English: 'The winking of the eyes is essentially automatic.',
            Russian: 'Глаза моргают непроизвольно.',
          },
        ],
      },
    ]);
    // A fresh object per phrase.
    expect(new Set(phrases.map((p) => p.explanations)).size).toBe(phrases.length);
  });

  it('keeps one phrase per headword', async () => {
    const { toLegacyPhrases } = await import('./examples/migration-legacy.js');
    const { article } = await import('../../src/article/index.js');
    const text = `${EN_DE.slice(0, EN_DE.indexOf('cat'))}we\nwo\n\t[m1][trn]wir[/trn]\n`;
    const dict = parseDsl(text);
    const header = await dict.header;
    const [entry] = await collect(dict.entries({ plugin: article }));
    const phrases = entry === undefined ? [] : toLegacyPhrases(entry, header);
    expect(phrases).toEqual([
      { phrase: 'we', explanations: [{ translations: ['wir'] }] },
      { phrase: 'wo', explanations: [{ translations: ['wir'] }] },
    ]);
    expect(phrases[0]).not.toBe(phrases[1]);
  });
});
