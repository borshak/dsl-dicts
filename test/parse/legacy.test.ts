import { describe, expect, it } from 'vitest';
import { type DslEntry, parseDsl, walk } from '../../src/index.js';

// Bundler-level imports instead of node:fs, so the test also runs in a browser.
const fixtures = import.meta.glob<string>('../fixtures/legacy/*.dsl', {
  query: '?raw',
  import: 'default',
  eager: true,
});

async function parseFixture(name: string) {
  const text = fixtures[`../fixtures/legacy/${name}`];
  if (text === undefined) throw new Error(`Missing fixture ${name}`);
  const dict = parseDsl(new TextEncoder().encode(text));
  const entries: DslEntry[] = [];
  for await (const entry of dict.entries()) entries.push(entry);
  // The dictionary keeps the diagnostics of every layer, those of the entries included.
  const codes = dict.diagnostics.map((d) => d.code);
  expect(codes.filter((code) => /^DSL[34]/.test(code))).toEqual(
    entries.flatMap((e) => e.diagnostics ?? []).map((d) => d.code),
  );
  return { header: await dict.header, entries, codes };
}

describe('legacy fixtures through parseDsl', () => {
  it('simplest.dsl: one entry with the three headwords we, wo, wa', async () => {
    const { header, entries, codes } = await parseFixture('simplest.dsl');
    expect(header.indexLanguageInfo?.name).toBe('English');
    expect(header.contentsLanguageInfo?.name).toBe('Russian');
    expect(entries.map((e) => e.headwords.map((h) => h.variants))).toEqual([
      [['The simples DSL dictionary']],
      [['i']],
      [['you']],
      [['we'], ['wo'], ['wa']],
      [['they']],
      [['hello']],
    ]);
    // dsl-dicts 1.x yielded one item per headword: 8.
    expect(entries.flatMap((e) => e.headwords)).toHaveLength(8);
    // The parentheses of the body are text, not optional parts.
    expect(entries[3]?.body).toMatchObject([
      { type: 'text', text: 'мы' },
      { type: 'lineBreak' },
      { type: 'text', text: '(2 times!)' },
      { type: 'lineBreak' },
      { type: 'text', text: '3rd line' },
    ]);
    expect(codes).toEqual([]);
  });

  it('basic_en-ru.dsl: four entries with trimmed headwords and parsed bodies', async () => {
    const { entries, codes } = await parseFixture('basic_en-ru.dsl');
    expect(entries.map((e) => e.headwords.map((h) => [h.raw, h.text, ...h.variants]))).toEqual([
      [['automatic', 'automatic', 'automatic']],
      [['extra', 'extra', 'extra']],
      [['money', 'money', 'money']],
      [['province', 'province', 'province']],
    ]);
    const tags = new Set<string>();
    for (const entry of entries) {
      walk(entry.body, (node) => {
        if (node.type === 'tag') tags.add(node.name);
      });
    }
    expect([...tags]).toEqual(expect.arrayContaining(['t', 'p', 's', 'm', 'trn', 'ex', 'lang']));
    // Crossed tags such as [/ex][/i], which the fixture has on purpose.
    expect(codes).toEqual(['DSL4203', 'DSL4203', 'DSL4203', 'DSL4203']);
  });
});
