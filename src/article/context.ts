/**
 * What classifiers and extractors receive.
 *
 * @packageDocumentation
 */

import type { DictionaryContext, Headword } from '../index.js';

/**
 * The options of the `article` plugin with their defaults applied (see
 * `ArticlePluginOptions`, which documents each of them).
 *
 * @experimental
 */
export interface ResolvedArticleOptions {
  /** Include labels; default `true`. Applied by the plugin to what the extractor builds. */
  readonly labels: boolean;
  /** Give labels their expansion from the dictionary's abbreviations; default `true`. */
  readonly expandLabels: boolean;
  /** How `[']` stresses are rendered in texts; default `none`. */
  readonly stress: 'none' | 'combining';
  /** Include the secondary content of `[*]`; default `true`. */
  readonly secondary: boolean;
  /** Split translations at semicolons outside brackets; default `true`. */
  readonly splitTranslations: boolean;
}

/**
 * What a classifier or an extractor knows besides the markup: the dictionary, the options,
 * and the headwords of the article being built (of the entry, or of a sub-entry).
 *
 * @experimental
 */
export interface ExtractionContext {
  /** The context the plugin was set up with: the header, abbreviations, annotation... */
  readonly dictionary: DictionaryContext;
  /** The options of the plugin, with their defaults. */
  readonly options: ResolvedArticleOptions;
  /** The headwords of the article being built. */
  readonly headwords: readonly Headword[];
  /**
   * What `~` stands for: the first index form of the entry's first headword, in the entry and
   * in its sub-entries alike. `undefined` keeps `~` as written.
   */
  readonly tilde: string | undefined;
}
