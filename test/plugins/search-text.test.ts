import { describe, expect, it } from 'vitest';
import { createDictionaryContext, type DslEntry, parseDsl, setupPlugin } from '../../src/index.js';
import { type SearchTextPluginOptions, searchText } from '../../src/plugins/index.js';
import { collect, entriesOf, HEADER } from '../plugin/helpers.js';

const DICT =
  'colo(u)r\n{[p]n[/p]} hue\n' +
  '\t[m0][b]~[/b] [t]ˈkʌlə[/t] [s]color.wav[/s]\n' +
  '\t[m1]1) [trn][p]n[/p] tint,  [i]shade[/i] [!trs](rare)[/!trs][/trn]\n' +
  '\t[m2][*][ex]^~ red [s]red.jpg[/s][/ex][/*]\n' +
  '\t[m1]2) [com]see <<hue>>[/com] [trn][i]crossed[/trn] tail[/i]\n' +
  '\t@ ~ code\n\t@ colo(u)r\n' +
  '\t[m1][trn]a code[/trn]\n' +
  '\t@\n' +
  'plain\n\t[m1][p]adj.[/p] just [b]text[/b] [!trs]hidden[/!trs]\n\t[s]a.wav[/s] second line\n';

function run(entries: readonly DslEntry[], options?: SearchTextPluginOptions) {
  return entries.map(setupPlugin(searchText, createDictionaryContext(), options));
}

describe('search-text plugin', () => {
  it('is named and versioned', () => {
    expect(searchText).toMatchObject({ name: 'search-text', version: '1.0.0' });
  });

  it('indexes all index forms and the text of the zones, of frozen entries', async () => {
    const entries = await entriesOf(DICT);
    expect(run(entries)).toEqual([
      {
        headwords: ['color', 'colour', 'hue', 'color code'],
        text: 'tint, shade\nColor red\nsee hue\ncrossed\na code',
      },
      // No zones: the plain text, without labels, [!trs] and media.
      { headwords: ['plain'], text: 'just text\nsecond line' },
    ]);
  });

  it('takes the zones, the fallback and sub-entries from its options', async () => {
    const entries = await entriesOf(DICT);
    expect(run(entries, { zones: ['com'] })[0]?.text).toBe('see hue');
    expect(run(entries, { secondary: false })[0]?.text).toBe(
      'tint, shade\nsee hue\ncrossed\na code',
    );
    expect(run(entries, { subentries: false })[0]).toEqual({
      headwords: ['color', 'colour', 'hue'],
      text: 'tint, shade\nColor red\nsee hue\ncrossed',
    });
    expect(run(entries, { fallback: 'none' })[1]).toEqual({ headwords: ['plain'], text: '' });
  });

  it('runs through parseDsl, with JSON-serializable output', async () => {
    const out = await collect(parseDsl(HEADER + DICT).batches({ plugin: searchText }));
    expect(out.flat()).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('rejects invalid options at setup', () => {
    const context = createDictionaryContext();
    for (const options of [
      { zone: ['trn'] },
      { zones: 'trn' },
      { zones: [1] },
      { fallback: 'all' },
      null,
    ]) {
      expect(() => setupPlugin(searchText, context, options as never)).toThrow(
        expect.objectContaining({ code: 'DSL5001', plugin: 'search-text' }),
      );
    }
  });
});
