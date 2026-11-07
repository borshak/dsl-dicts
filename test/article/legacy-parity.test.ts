/**
 * Parity with dsl-dicts 1.x: the assertions of its tests (`basic.test.ts`, `simplest.test.ts`),
 * on the same fixtures, against the article plugin.
 *
 * How the 1.x output maps to the article:
 * - `meta.name`, `meta.language.source`, `meta.language.target` are the header's `name`,
 *   `indexLanguageInfo.name` and `contentsLanguageInfo.name`.
 * - 1.x gave one item per headword (`phrase`); the article has one per entry, with all its
 *   `headwords`.
 * - An `explanations[i]` of 1.x was not a sense: it gathered the translations of the
 *   `[trn]` lines up to the next `[ex]` line, and the examples after them. The article has
 *   the sense tree instead, so each 1.x translation and example is asserted in the sense it
 *   belongs to (noted at each assertion).
 * - A 1.x translation was the whole `[trn]` zone with its tags removed; the article splits it
 *   at semicolons (option `splitTranslations`) and takes labels and comments out of it.
 *   Where that changes a 1.x value, the corrected value is asserted, with the reason.
 * - `examples[j].English` / `.Russian` are `source.text` / `target.text`, whose `language`
 *   is the Lingvo name.
 * - A body without tags (`simplest.dsl`) gave one explanation with the lines as
 *   translations; the article has one unnumbered sense (kind `plain`) with the same.
 */

import { describe, expect, it } from 'vitest';
import { type Article, type ArticleOptions, article } from '../../src/article/index.js';
import { parseDsl } from '../../src/index.js';
import { collect } from './helpers.js';

// Bundler-level imports instead of node:fs, so the test also runs in a browser.
const fixtures = import.meta.glob<string>('../fixtures/legacy/*.dsl', {
  query: '?raw',
  import: 'default',
  eager: true,
});

async function read(name: string, options?: ArticleOptions) {
  const text = fixtures[`../fixtures/legacy/${name}`];
  if (text === undefined) throw new Error(`Missing fixture ${name}`);
  const dict = parseDsl(new TextEncoder().encode(text));
  const articles: Article[] = await collect(dict.entries({ plugin: article, options }));
  return { header: await dict.header, articles };
}

describe('legacy parity: basic_en-ru.dsl', () => {
  it('has the meta data of 1.x in the header', async () => {
    const { header } = await read('basic_en-ru.dsl');
    expect(header.name).toBe('Basic dictionary for tests');
    expect(header.indexLanguageInfo?.name).toBe('English');
    expect(header.contentsLanguageInfo?.name).toBe('Russian');
  });

  it('has the four entries, then nothing', async () => {
    const { articles } = await read('basic_en-ru.dsl');
    expect(articles.map((a) => a.headwords.map((h) => h.text))).toEqual([
      ['automatic'],
      ['extra'],
      ['money'],
      ['province'],
    ]);
  });

  it('automatic: the translations and examples of the three 1.x explanations', async () => {
    const [automatic] = (await read('basic_en-ru.dsl')).articles;
    // 1.x: three explanations; here two parts of speech (1. прил., 2. сущ.) with their senses.
    const [adjective, noun] = automatic?.senses ?? [];
    expect(adjective?.labels).toEqual([{ text: 'прил.' }]);
    expect(noun?.labels).toEqual([{ text: 'сущ.' }]);
    // explanations[0].translations[0] and [1]: senses 1) and 2) of 1. прил.
    expect(adjective?.senses[0]?.translations).toEqual(['автоматический, автоматизированный']);
    expect(adjective?.senses[1]?.translations).toEqual(['машинальный, непроизвольный']);
    // explanations[0].examples (one): the example of sense 2) of 1. прил.
    expect(adjective?.senses[1]?.examples).toEqual([
      {
        source: { text: 'The winking of the eyes is essentially automatic.', language: 'English' },
        target: { text: 'Глаза моргают непроизвольно.', language: 'Russian' },
      },
    ]);
    // explanations[1].examples[0]: the example of sense 1) of 2. сущ.
    expect(noun?.senses[0]?.examples).toEqual([
      {
        source: {
          text: 'Failures of the automatics may be more dangerous than the human failures they are designed to prevent.',
          language: 'English',
        },
        target: {
          text: 'Ошибки автоматов могут быть более опасными, чем человеческие ошибки, которые эти устройства должны предотвращать.',
          language: 'Russian',
        },
      },
    ]);
    // 1.x README: explanations[1].translations[0] 'автоматическое устройство; автомат', now split.
    expect(noun?.senses[0]?.translations).toEqual(['автоматическое устройство', 'автомат']);
    expect(automatic?.transcriptions).toEqual(["ˌɔːtə'mætɪk"]);
  });

  it('extra: one explanation with one translation and no examples', async () => {
    const whole = 'дополнительный; дополнительно; особо; добавочный; экстра; статист; экстренный';
    const [, extra] = (await read('basic_en-ru.dsl')).articles;
    expect(extra?.senses).toHaveLength(1);
    expect(extra?.senses[0]?.examples).toEqual([]);
    // 1.x kept the zone whole; it is split at semicolons by default.
    expect(extra?.senses[0]?.translations).toHaveLength(7);
    expect(extra?.senses[0]?.translations.join('; ')).toBe(whole);
    const [, unsplit] = (await read('basic_en-ru.dsl', { splitTranslations: false })).articles;
    expect(unsplit?.senses[0]?.translations).toEqual([whole]);
  });

  it('money: the translations and examples of the two 1.x explanations', async () => {
    const [, , money] = (await read('basic_en-ru.dsl')).articles;
    const [one, two, three, idioms] = money?.senses ?? [];
    expect([one?.number, two?.number, three?.number, idioms?.number]).toEqual([
      '1',
      '2',
      '3',
      undefined,
    ]);
    const [a, b, c] = one?.senses ?? [];
    // explanations[0].translations: ['употр. с гл. в ед. деньги'] is sense 1) а). 1.x read the
    // label [p]употр. с гл. в ед.[/p] (crossed with [trn]) as part of the translation.
    expect(a?.number).toBe('а');
    expect(a?.labels).toEqual([{ text: 'употр. с гл. в ед.' }]);
    expect(a?.translations).toEqual(['деньги']);
    // explanations[0].examples: the 16 examples of 1) а).
    expect(a?.examples).toHaveLength(16);
    expect(a?.examples.every((e) => e.source.language === 'English')).toBe(true);
    // explanations[1].translations[0..3]: senses 1) б), 1) в), 2) and 3); 1.x had 4 strings.
    expect(b?.translations).toEqual(['платёжное средство']);
    expect(c?.translations).toEqual(['богатство', 'собственность']);
    expect(two?.translations).toEqual(['национальная валюта']);
    // [3] was '(monies) юр. денежные суммы': the comment and the label are taken out.
    expect(three).toMatchObject({
      labels: [{ text: 'юр.' }],
      translations: ['денежные суммы'],
      comments: ['monies'],
    });
    // explanations[1].examples (two): the idioms after the • separator, an unnumbered sense.
    expect(idioms?.examples).toEqual([
      {
        source: { text: 'He has money to burn.', language: 'English' },
        target: { text: 'У него денег куры не клюют.', language: 'Russian' },
      },
      {
        source: { text: 'Money makes money.', language: 'English' },
        // 1.x gave ' посл. — Деньги к деньгам.': it cut the target at [/lang] and removed only
        // a dash at its very start, so the label and the dash stayed. The label is the
        // example's (a proverb).
        target: { text: 'Деньги к деньгам.', language: 'Russian' },
        labels: [{ text: 'посл.' }],
      },
    ]);
  });

  it('province: the last entry', async () => {
    const { articles } = await read('basic_en-ru.dsl');
    const province = articles.at(-1);
    expect(province?.headwords[0]?.text).toBe('province');
    expect(province?.labels).toEqual([{ text: 'n' }]);
    expect(province?.senses.map((s) => s.translations)).toEqual([
      ['провинция'],
      ['провинция, периферия'],
      ['компетенция'],
    ]);
    expect(province?.senses[0]?.comments).toEqual(['единица административного деления']);
  });
});

describe('legacy parity: simplest.dsl', () => {
  it('has the meta data of 1.x in the header', async () => {
    const { header } = await read('simplest.dsl');
    expect(header.name).toBe('Simplest dictionary');
    expect(header.indexLanguageInfo?.name).toBe('English');
    expect(header.contentsLanguageInfo?.name).toBe('Russian');
  });

  it('has the eight headwords of 1.x, in six entries', async () => {
    const { articles } = await read('simplest.dsl');
    expect(articles).toHaveLength(6);
    expect(articles.flatMap((a) => a.headwords)).toHaveLength(8);
  });

  it('gives plain bodies one sense with the lines as translations', async () => {
    const [first, , you, we] = (await read('simplest.dsl')).articles;
    expect(first?.headwords[0]?.text).toBe('The simples DSL dictionary');
    expect(first?.kind).toBe('plain');
    expect(first?.senses).toHaveLength(1);
    expect(first?.senses[0]?.examples).toEqual([]);
    expect(first?.senses[0]?.translations[0]).toBe('Простейший DSL-словарь');
    expect(you?.headwords[0]?.text).toBe('you');
    expect(you?.senses).toHaveLength(1);
    expect(you?.senses[0]?.examples).toEqual([]);
    expect(you?.senses[0]?.translations[0]).toBe('ты');
    // Three headwords, three lines.
    expect(we?.headwords.map((h) => h.text)).toEqual(['we', 'wo', 'wa']);
    expect(we?.senses[0]?.translations).toEqual(['мы', '(2 times!)', '3rd line']);
  });
});
