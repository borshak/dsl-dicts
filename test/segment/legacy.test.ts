import { describe, expect, it } from 'vitest';
import { headwords, segmentAsync } from './helpers.js';

// Bundler-level imports instead of node:fs, so the test also runs in a browser.
const fixtures = import.meta.glob<string>('../fixtures/legacy/*.dsl', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function fixture(name: string): Uint8Array {
  const text = fixtures[`../fixtures/legacy/${name}`];
  if (text === undefined) throw new Error(`Missing fixture ${name}`);
  return new TextEncoder().encode(text);
}

describe('legacy fixtures', () => {
  it('simplest.dsl: 6 entries, one with 3 headwords', async () => {
    const { header, entries, codes } = await segmentAsync(fixture('simplest.dsl'));
    expect(header).toMatchObject({
      name: 'Simplest dictionary',
      indexLanguage: 'English',
      contentsLanguage: 'Russian',
    });
    expect(headwords(entries)).toEqual([
      ['The simples DSL dictionary'],
      ['i'],
      ['you'],
      ['we', 'wo', 'wa'],
      ['they'],
      ['hello'],
    ]);
    // dsl-dicts 1.x yielded one item per headword: 8.
    expect(entries.flatMap((e) => e.headwords)).toHaveLength(8);
    expect(entries[3]?.body.map((l) => [l.indent, l.text])).toEqual([
      ['    ', 'мы'],
      ['    ', '(2 times!)'],
      ['\t', '3rd line'],
    ]);
    expect(codes).toEqual([]);
  });

  it('basic_en-ru.dsl: 4 entries', async () => {
    const { header, entries, codes } = await segmentAsync(fixture('basic_en-ru.dsl'));
    expect(header?.name).toBe('Basic dictionary for tests');
    expect(headwords(entries)).toEqual([['automatic'], ['extra'], ['money'], ['province']]);
    expect(entries.every((e) => e.body.length > 0)).toBe(true);
    expect(entries[0]?.body[0]?.text.startsWith('\\[[t]')).toBe(true);
    expect(codes).toEqual([]);
  });
});
