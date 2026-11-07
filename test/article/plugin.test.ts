import { describe, expect, it } from 'vitest';
import {
  ARTICLE_VERSION,
  type Article,
  article,
  classifyBody,
  createArticlePlugin,
  DEFAULT_EXTRACTORS,
  type Extractor,
  extractZoneMarked,
} from '../../src/article/index.js';
import { parseDsl } from '../../src/index.js';
import { thrown } from '../plugin/helpers.js';
import { articleOf, articlesOf, collect, entry, HEADER, sense } from './helpers.js';

describe('article plugin', () => {
  it('is named and versioned', () => {
    expect(article).toMatchObject({ name: 'article', version: ARTICLE_VERSION });
    expect(ARTICLE_VERSION).toBe('1.0.0');
  });

  it('runs through parseDsl, with the header languages', async () => {
    const text = `${HEADER}cat\n\t[m1][trn]кошка[/trn][/m]\n\t[m2][ex][lang id=1033]a cat[/lang] — кошка[/ex][/m]\n`;
    const [a] = await collect(parseDsl(text).entries({ plugin: article }));
    expect(a).toEqual({
      kind: 'zone-marked',
      headwords: [{ text: 'cat', variants: ['cat'] }],
      transcriptions: [],
      media: [],
      labels: [],
      senses: [
        sense({
          translations: ['кошка'],
          examples: [
            {
              source: { text: 'a cat', language: 'English' },
              target: { text: 'кошка', language: 'Russian' },
            },
          ],
        }),
      ],
      references: [],
      comments: [],
      subentries: [],
    });
  });

  it('gives an article per entry, with all its headwords', async () => {
    const list = await articlesOf('a\nb\n\t[trn]x[/trn]\nc\n\ty\n');
    expect(list.map((a) => [a.kind, a.headwords.map((h) => h.text)])).toEqual([
      ['zone-marked', ['a', 'b']],
      ['plain', ['c']],
    ]);
  });

  it('reads sub-entries as articles, ~ being the headword of the entry', async () => {
    const a = await articleOf(
      'colo(u)r\n\t[m1][trn]hue[/trn][/m]\n\t[m1]@ ~ code\n\t[m1][trn]a ~ code[/trn][/m]\n\t[m2][ex][lang id=1033]^~ code[/lang] — код[/ex][/m]\n\t@\n\t[m1][trn]tint[/trn][/m]\n',
    );
    expect(a.senses.map((s) => s.translations)).toEqual([['hue'], ['tint']]);
    expect(a.subentries).toEqual([
      {
        kind: 'zone-marked',
        headwords: [{ text: 'color code', variants: ['color code'] }],
        transcriptions: [],
        media: [],
        labels: [],
        senses: [
          sense({
            translations: ['a color code'],
            examples: [
              {
                source: { text: 'Color code', language: 'English' },
                target: { text: 'код', language: 'Russian' },
              },
            ],
          }),
        ],
        references: [],
        comments: [],
        subentries: [],
      },
    ]);
  });

  it('keeps every text it cannot place as a note', async () => {
    const a = await articleOf(entry('[c]<-s>[/c]', '[m1][trn]a[/trn] (b)[/m]'));
    expect(a.notes).toEqual(['<-s>']);
    expect(a.senses[0]?.notes).toEqual(['(b)']);
  });

  it('reads every entry with one extractor when asked: option kind', async () => {
    const a = await articleOf(entry('[m1]1. a[/m]'), { kind: 'zone-marked' });
    expect(a).toMatchObject({ kind: 'zone-marked', senses: [{ number: '1', notes: ['a'] }] });
    const b = await articleOf(entry('[m1]1. a[/m]'));
    expect(b).toMatchObject({
      kind: 'layout-only',
      senses: [{ number: '1', translations: ['a'] }],
    });
  });

  it('checks its options', async () => {
    for (const options of [
      'x',
      { color: true },
      { labels: 'expanded' },
      { expandLabels: 'no' },
      { stress: 'acute' },
      { secondary: 'yes' },
      { splitTranslations: 1 },
      { kind: 'unknown' },
    ]) {
      const error = thrown(() => article.setup({} as never, options as never));
      expect(error, JSON.stringify(options)).toMatchObject({ code: 'DSL0001' });
    }
    await expect(articlesOf('a\n\tb\n', { kind: 'nope' })).rejects.toMatchObject({
      code: 'DSL0001',
      plugin: 'article',
    });
  });

  it('checks its configuration', () => {
    for (const config of [
      null,
      { classify: 'x' },
      { extractors: null },
      { extractors: { x: 1 } },
      { profile: 'x' },
      { name: 'two words' },
      { version: '1.0' },
      { version: 2 },
    ]) {
      expect(
        thrown(() => createArticlePlugin(config as never)),
        JSON.stringify(config),
      ).toMatchObject({ code: 'DSL0001' });
    }
  });
});

describe('createArticlePlugin', () => {
  it('registers an extractor for a dictionary family, picked by a classifier', async () => {
    const shouting: Extractor = (body, context) => {
      const content = extractZoneMarked(body, context);
      return {
        ...content,
        senses: content.senses.map((s) => ({
          ...s,
          translations: s.translations.map((t) => t.toUpperCase()),
        })),
      };
    };
    const plugin = createArticlePlugin({
      name: 'loud-article',
      extractors: { loud: shouting },
      classify: (body, context) =>
        context.dictionary.header.name === 'Loud' ? 'loud' : classifyBody(body, context),
    });
    expect(plugin).toMatchObject({ name: 'loud-article', version: ARTICLE_VERSION });
    expect(createArticlePlugin({ name: 'loud-article', version: '0.3.1' }).version).toBe('0.3.1');
    const text = 'w\n\t[m1][trn]quiet[/trn][/m]\n';
    const loud = await articleOf(text, undefined, { plugin, header: '#NAME "Loud"\n' });
    expect(loud).toMatchObject({ kind: 'loud', senses: [{ translations: ['QUIET'] }] });
    const other = await articleOf(text, undefined, { plugin });
    expect(other).toMatchObject({ kind: 'zone-marked', senses: [{ translations: ['quiet'] }] });
    // Its extractors can be forced too.
    const forced = await articleOf(text, { kind: 'loud' }, { plugin });
    expect(forced.kind).toBe('loud');
  });

  it('replaces built-in extractors', async () => {
    const empty: Extractor = () => ({
      transcriptions: [],
      media: [],
      labels: [],
      senses: [],
      references: [],
      comments: [],
      notes: [],
    });
    const plugin = createArticlePlugin({ extractors: { plain: empty } });
    const a: Article = await articleOf(entry('just text'), undefined, { plugin });
    expect(a).toMatchObject({ kind: 'plain', senses: [] });
    // Empty notes are left out.
    expect('notes' in a).toBe(false);
    expect(Object.keys(DEFAULT_EXTRACTORS)).toEqual([
      'zone-marked',
      'layout-only',
      'plain',
      'reference-only',
      'media-only',
    ]);
  });

  it('reports a classifier that names no extractor as a plugin failure', async () => {
    const plugin = createArticlePlugin({ classify: () => 'missing' });
    await expect(articlesOf('a\n\tb\n', undefined, { plugin })).rejects.toMatchObject({
      code: 'DSL5002',
      plugin: 'article',
    });
  });
});
