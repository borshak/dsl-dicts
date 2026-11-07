import { describe, expect, it } from 'vitest';
import { createDictionaryContext, type DslEntry, parseDsl, setupPlugin } from '../../src/index.js';
import { type PlainTextPluginOptions, plainText } from '../../src/plugins/index.js';
import { collect, entriesOf, HEADER, thrown } from '../plugin/helpers.js';

const DICT =
  'colo(u)r\n{[p]n[/p]} hue\n' +
  '\t[m0][b]~[/b] [t]ˈkʌlə[/t] [s]color.wav[/s]\n' +
  '\t[m1]1) [trn][p]n[/p] tint, [i]shade[/i][/trn]\n' +
  '\t[m2][*][ex]^~ red[/ex][/*]\n' +
  '\t[m1]2) [trn][i]crossed[/trn] tail[/i]\n' +
  '\t@ ~ code\n' +
  '\t[m1][trn]a code[/trn]\n' +
  '\t@\n' +
  'plain\n\tjust text\n\tsecond line\n';

function run(
  entries: readonly DslEntry[],
  options?: PlainTextPluginOptions,
  abbreviations?: Map<string, string>,
) {
  const context = createDictionaryContext(abbreviations === undefined ? {} : { abbreviations });
  return entries.map(setupPlugin(plainText, context, options));
}

describe('plain-text plugin', () => {
  it('is named and versioned', () => {
    expect(plainText).toMatchObject({ name: 'plain-text', version: '1.0.0' });
  });

  it('renders headwords and bodies of frozen entries', async () => {
    const entries = await entriesOf(DICT);
    expect(run(entries)).toEqual([
      {
        headwords: ['colo(u)r', 'n hue'],
        text: 'color ˈkʌlə\n1) n tint, shade\nColor red\n2) crossed tail\ncolor code\na code',
      },
      { headwords: ['plain'], text: 'just text\nsecond line' },
    ]);
  });

  it('passes its options on to toPlainText', async () => {
    const entries = await entriesOf(DICT);
    const [first] = run(entries, {
      indent: ' ',
      media: true,
      secondary: false,
      labels: false,
      subentries: false,
    });
    expect(first?.text).toBe('color ˈkʌlə color.wav\n 1) tint, shade\n 2) crossed tail');
  });

  it('passes the stress option on', async () => {
    const entries = await entriesOf("w\n\tпров[']и[/']нция\n");
    expect(run(entries)[0]?.text).toBe('провинция');
    expect(run(entries, { stress: 'combining' })[0]?.text).toBe('прови\u0301нция');
    expect(thrown(() => run(entries, { stress: 'x' as never }))).toMatchObject({ code: 'DSL0001' });
  });

  it('expands labels from the context abbreviations when asked', async () => {
    const entries = await entriesOf(DICT);
    const abbreviations = new Map([['n', 'noun']]);
    expect(run(entries, { expandLabels: true }, abbreviations)[0]?.text).toContain('1) noun tint');
    expect(run(entries, {}, abbreviations)[0]?.text).toContain('1) n tint');
    expect(run(entries, { expandLabels: true })[0]?.text).toContain('1) n tint');
    expect(run(entries, { expandLabels: true, labels: false }, abbreviations)[0]?.text).toContain(
      '1) tint',
    );
    // Headwords keep their label as written: they are Headword.text.
    expect(run(entries, { expandLabels: true }, abbreviations)[0]?.headwords[1]).toBe('n hue');
  });

  it('runs through parseDsl with abbreviations from the options', async () => {
    const dict = parseDsl(HEADER + DICT, { abbreviations: new Map([['n', 'noun']]) });
    const out = await collect(dict.entries({ plugin: plainText, options: { expandLabels: true } }));
    expect(out[0]?.text).toContain('noun tint');
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('rejects unknown options at setup', async () => {
    const error = await collect(
      parseDsl(HEADER + DICT).entries({ plugin: plainText, options: { indnet: ' ' } as never }),
    ).catch((e: unknown) => e);
    // An invalid option stays a DSL0001, with the plugin named.
    expect(error).toMatchObject({
      code: 'DSL0001',
      plugin: 'plain-text',
      message: 'Plugin plain-text@1.0.0: The plain-text plugin has no option indnet.',
    });
    const context = createDictionaryContext();
    expect(() => setupPlugin(plainText, context, 'x' as never)).toThrow(
      /options must be an object/,
    );
  });
});
