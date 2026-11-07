/**
 * What classifiers and extractors receive.
 *
 * @packageDocumentation
 */

import type { DictionaryContext, Headword } from '../index.js';

/**
 * The options of the `article` plugin with their defaults applied (see `ArticleOptions`).
 *
 * @experimental
 */
export interface ResolvedArticleOptions {
  readonly labels: 'expand' | 'keep';
  readonly stress: 'none' | 'combining';
  readonly secondary: boolean;
  readonly splitTranslations: boolean;
}

/**
 * What a classifier or an extractor knows besides the markup: the dictionary, the options,
 * and the headwords of the article being built (of the entry, or of a sub-entry).
 *
 * @experimental
 */
export interface ExtractionContext {
  readonly dictionary: DictionaryContext;
  readonly options: ResolvedArticleOptions;
  /** The headwords of the article being built. */
  readonly headwords: readonly Headword[];
  /**
   * What `~` stands for: the first index form of the entry's first headword, in the entry and
   * in its sub-entries alike. `undefined` keeps `~` as written.
   */
  readonly tilde: string | undefined;
}
