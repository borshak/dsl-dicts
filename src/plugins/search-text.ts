/**
 * The `search-text` plugin.
 *
 * @packageDocumentation
 */

import {
  DslError,
  definePlugin,
  hasZones,
  type MarkupNode,
  type PlainTextOptions,
  SEARCH_ZONES,
  toPlainText,
  walk,
  zoneText,
} from '../index.js';

/**
 * Output of the `search-text` plugin. JSON-serializable.
 *
 * @experimental
 */
export interface SearchTextResult {
  /**
   * Every index form (`Headword.variants`) of the entry's headwords, then of its sub-entries'
   * headwords, without duplicates, in order. Sub-entries are listed in the index of a DSL
   * dictionary like entries.
   */
  readonly headwords: string[];
  /**
   * The searchable text of the body: one line per search zone (see `zoneText`), or, for a
   * body without zones, the plain text (see the `fallback` option).
   */
  readonly text: string;
}

/**
 * Options of the `search-text` plugin.
 *
 * @experimental
 */
export interface SearchTextPluginOptions
  extends Pick<PlainTextOptions, 'secondary' | 'subentries'> {
  /** The zone tags to index. Default `SEARCH_ZONES`: `trn`, `trn1`, `ex`, `com`. */
  readonly zones?: readonly string[];
  /**
   * What the text is for a body without any zone tag, as in dictionaries that mark none:
   * `plain-text` (the default), the body's plain text without `[!trs]`, `[p]` labels and
   * media, one line per line; or `none`, an empty text.
   */
  readonly fallback?: 'plain-text' | 'none';
}

const KEYS = new Set(['secondary', 'subentries', 'zones', 'fallback']);

/**
 * Extracts what a full-text search should index from each entry: the index forms of its
 * headwords, and the text of its search zones (`[trn]`, `[ex]`, `[com]`) without `[!trs]`,
 * labels and media, with `~` substituted and whitespace collapsed. Entries without zones
 * fall back to their plain text (option `fallback`).
 *
 * @experimental
 */
export const searchText = definePlugin({
  name: 'search-text',
  version: '1.0.0',
  setup(_context, options: SearchTextPluginOptions | undefined) {
    const {
      zones = SEARCH_ZONES,
      fallback = 'plain-text',
      secondary,
      subentries,
    } = checkOptions(options);
    const base: PlainTextOptions = { secondary, subentries };
    const includeSubentries = subentries !== false;
    return (entry): SearchTextResult => {
      const render = { ...base, headwords: entry.headwords };
      let text = '';
      if (hasZones(entry.body, zones)) {
        text = zoneText(entry.body, zones, render);
      } else if (fallback === 'plain-text') {
        text = toPlainText(entry.body, {
          ...render,
          unindexed: false,
          labels: false,
          media: false,
        });
      }
      const forms = new Set<string>();
      for (const headword of entry.headwords) {
        for (const form of headword.variants) forms.add(form);
      }
      if (includeSubentries) collectSubentryForms(entry.body, forms);
      return { headwords: [...forms], text };
    };
  },
});

function collectSubentryForms(body: readonly MarkupNode[], forms: Set<string>): void {
  walk(body, (node) => {
    if (node.type === 'subentry') {
      for (const headword of node.headwords) {
        for (const form of headword.variants) forms.add(form);
      }
    }
    return undefined;
  });
}

function checkOptions(options: SearchTextPluginOptions | undefined): SearchTextPluginOptions {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'The search-text options must be an object.');
  }
  for (const key of Object.keys(options)) {
    if (!KEYS.has(key)) {
      throw DslError.of('invalidArgument', `The search-text plugin has no option ${key}.`);
    }
  }
  const { zones, fallback } = options;
  if (zones !== undefined && (!Array.isArray(zones) || zones.some((z) => typeof z !== 'string'))) {
    throw DslError.of('invalidArgument', 'The zones option must be an array of tag names.');
  }
  if (fallback !== undefined && fallback !== 'plain-text' && fallback !== 'none') {
    throw DslError.of('invalidArgument', 'The fallback option must be "plain-text" or "none".');
  }
  return options;
}
