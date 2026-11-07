/**
 * The `plain-text` plugin.
 *
 * @packageDocumentation
 */

import { DslError, definePlugin, type ToPlainTextOptions, toPlainText } from '../index.js';

/** Output of the `plain-text` plugin. JSON-serializable. */
export interface PlainTextResult {
  /** The display text of each headword (`Headword.text`), in order. */
  readonly headwords: readonly string[];
  /** The body as plain text; see `toPlainText`. */
  readonly text: string;
}

/**
 * Options of the `plain-text` plugin: those of `toPlainText` that are not about the entry.
 * `expandLabels` expands labels with the dictionary's abbreviations
 * (`DictionaryContext.abbreviations`), when they were read.
 */
export interface PlainTextPluginOptions
  extends Pick<
    ToPlainTextOptions,
    | 'indent'
    | 'secondary'
    | 'media'
    | 'unindexed'
    | 'labels'
    | 'expandLabels'
    | 'subentries'
    | 'stress'
  > {}

const KEYS = new Set([
  'indent',
  'secondary',
  'media',
  'unindexed',
  'labels',
  'subentries',
  'stress',
  'expandLabels',
]);

/**
 * Renders each entry as plain text: its headwords' display text and its body, with `~`
 * substituted, line breaks and `[m]` paragraphs as lines, and media left out (see
 * `toPlainText` for the rules and the options).
 *
 * @example
 * ```ts
 * for await (const { headwords, text } of parseDsl(bytes).entries({ plugin: plainText })) …
 * ```
 */
export const plainText = definePlugin({
  name: 'plain-text',
  version: '1.0.0',
  setup(context, options: PlainTextPluginOptions | undefined) {
    const render: ToPlainTextOptions = {
      ...checkOptions(options),
      abbreviations: context.abbreviations,
    };
    return (entry): PlainTextResult => ({
      headwords: entry.headwords.map((headword) => headword.text),
      text: toPlainText(entry.body, { ...render, headwords: entry.headwords }),
    });
  },
});

function checkOptions(options: PlainTextPluginOptions | undefined): PlainTextPluginOptions {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null) {
    throw new DslError('DSL0001', 'The plain-text options must be an object.');
  }
  for (const key of Object.keys(options)) {
    if (!KEYS.has(key)) {
      throw new DslError('DSL0001', `The plain-text plugin has no option ${key}.`);
    }
  }
  if (options.stress !== undefined && options.stress !== 'none' && options.stress !== 'combining') {
    throw new DslError('DSL0001', 'The stress option must be "none" or "combining".');
  }
  return options;
}
