/**
 * The `article` plugin: a semantic projection of DSL entries into senses, translations,
 * examples, labels and links, the successor of the output of dsl-dicts 1.x.
 *
 * DSL describes the layout of a card, not its meaning, so the article is a heuristic, and
 * **experimental**: its format may change in a minor version (see `ARTICLE_VERSION`), while
 * the AST it is built from is stable. A classifier tells the shape of each entry, and an
 * extractor for that shape builds the article; both can be replaced with
 * `createArticlePlugin`.
 *
 * Written against the public API of `dsl-dicts` only, like any third-party plugin.
 *
 * @packageDocumentation
 */

export { type Classifier, classifyBody } from './classify.js';
export type { ExtractionContext, ResolvedArticleOptions } from './context.js';
export {
  DEFAULT_EXTRACTORS,
  type Extractor,
  extractLayoutOnly,
  extractMediaOnly,
  extractPlain,
  extractReferenceOnly,
  extractZoneMarked,
} from './extractors.js';
export {
  ARTICLE_VERSION,
  type ArticlePluginConfig,
  type ArticlePluginOptions,
  article,
  createArticlePlugin,
} from './plugin.js';
export type {
  Article,
  ArticleContent,
  ArticleHeadword,
  ArticleKind,
  Example,
  ExampleText,
  Label,
  Media,
  Reference,
  Sense,
} from './types.js';
