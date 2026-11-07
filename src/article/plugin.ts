/**
 * The `article` plugin and its factory.
 *
 * @packageDocumentation
 */

import {
  DslError,
  type DslPlugin,
  definePlugin,
  type Headword,
  type MarkupNode,
  type SubentryNode,
  walk,
} from '../index.js';
import { type Classifier, classifyBody } from './classify.js';
import type { ExtractionContext, ResolvedArticleOptions } from './context.js';
import { DEFAULT_EXTRACTORS, type Extractor } from './extractors.js';
import type { Article, ArticleKind } from './types.js';

/**
 * Version of the article format: `Article` and the types it is made of. Experimental: a
 * minor version of dsl-dicts may change it.
 *
 * @experimental
 */
export const ARTICLE_VERSION = '1.0.0';

/**
 * Options of the `article` plugin, given when it is used (`entries({ plugin, options })`).
 *
 * @experimental
 */
export interface ArticleOptions {
  /**
   * `expand` (the default) gives each label its `expansion` from the dictionary's
   * abbreviations, when there are some; `keep` leaves labels as written.
   */
  readonly labels?: 'expand' | 'keep';
  /** How `[']` stresses are rendered in texts; see `PlainTextOptions.stress`. Default `none`. */
  readonly stress?: 'none' | 'combining';
  /**
   * Include the secondary content of `[*]` (shown by Lingvo in the full view only), where
   * most examples and links of a dictionary usually are. Default `true`.
   */
  readonly secondary?: boolean;
  /** Split translations at semicolons outside brackets. Default `true`. */
  readonly splitTranslations?: boolean;
  /**
   * Read every entry with this extractor instead of the one the classifier picks: a
   * built-in kind, or the name of a custom extractor of the plugin.
   */
  readonly kind?: ArticleKind;
}

/**
 * How {@link createArticlePlugin} makes a plugin.
 *
 * @experimental
 */
export interface ArticlePluginConfig {
  /** The plugin name. Default `article`; give another to tell a customized plugin apart. */
  readonly name?: string;
  /** Picks the extractor of each entry and sub-entry. Default `classifyBody`. */
  readonly classify?: Classifier;
  /**
   * Extractors by kind, added to the built-in ones (`DEFAULT_EXTRACTORS`) or replacing
   * them. A classifier may return the name of any of them.
   */
  readonly extractors?: Readonly<Record<string, Extractor>>;
}

const OPTION_KEYS = new Set(['labels', 'stress', 'secondary', 'splitTranslations', 'kind']);
const CONFIG_KEYS = new Set(['name', 'classify', 'extractors']);

/**
 * Makes an `article` plugin, with a classifier and extractors of your own if need be.
 *
 * The plugin reads each entry in three steps: the classifier tells its shape (its
 * `ArticleKind`), the extractor of that kind builds the article content, and each sub-entry
 * is read the same way as an article of its own. A dictionary family whose markup the
 * built-in extractors read poorly gets a profile: an extractor for it, and a classifier
 * that picks it, for example by the dictionary name.
 *
 * @example
 * ```ts
 * import { classifyBody, createArticlePlugin, extractZoneMarked } from 'dsl-dicts/article';
 *
 * const myArticle = createArticlePlugin({
 *   name: 'my-article',
 *   extractors: {
 *     // Starts from the built-in reading and drops the notes.
 *     'my-family': (body, context) => ({ ...extractZoneMarked(body, context), notes: [] }),
 *   },
 *   classify: (body, context) =>
 *     context.dictionary.header.name?.startsWith('My ') ? 'my-family' : classifyBody(body, context),
 * });
 * for await (const article of parseDsl(bytes).entries({ plugin: myArticle })) …
 * ```
 *
 * @throws DslError `DSL0001` for an invalid configuration.
 * @experimental
 */
export function createArticlePlugin(
  config: ArticlePluginConfig = {},
): DslPlugin<Article, ArticleOptions | undefined> {
  const { name = 'article', classify = classifyBody, extractors = {} } = checkConfig(config);
  const table: Readonly<Record<string, Extractor>> = { ...DEFAULT_EXTRACTORS, ...extractors };
  return definePlugin({
    name,
    version: ARTICLE_VERSION,
    setup(dictionary, options: ArticleOptions | undefined) {
      const { kind: forced, ...resolved } = checkOptions(options, table);
      return (entry): Article => {
        const tilde = entry.headwords[0]?.variants[0];
        const read = (body: readonly MarkupNode[], headwords: readonly Headword[]): Article => {
          const context: ExtractionContext = { dictionary, options: resolved, headwords, tilde };
          const kind = forced ?? classify(body, context);
          const extractor = table[kind];
          if (typeof extractor !== 'function') {
            throw DslError.of('invalidArgument', `The article plugin has no extractor ${kind}.`);
          }
          const { notes, ...content } = extractor(body, context);
          const article: { -readonly [K in keyof Article]: Article[K] } = {
            kind,
            headwords: headwords.map((h) => ({ text: h.text, variants: [...h.variants] })),
            ...content,
            subentries: subentriesOf(body).map((s) => read(s.children, s.headwords)),
          };
          if (notes !== undefined && notes.length > 0) article.notes = notes;
          return article;
        };
        return read(entry.body, entry.headwords);
      };
    },
  });
}

/** The sub-entries of a body, wherever they are. */
function subentriesOf(body: readonly MarkupNode[]): SubentryNode[] {
  const found: SubentryNode[] = [];
  walk(body, (node) => {
    if (node.type !== 'subentry') return undefined;
    found.push(node);
    return 'skip';
  });
  return found;
}

function checkConfig(config: ArticlePluginConfig): ArticlePluginConfig {
  if (typeof config !== 'object' || config === null) {
    throw DslError.of('invalidArgument', 'The article plugin configuration must be an object.');
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw DslError.of('invalidArgument', `The article plugin has no configuration ${key}.`);
    }
  }
  const { classify, extractors } = config;
  if (classify !== undefined && typeof classify !== 'function') {
    throw DslError.of('invalidArgument', 'The classify option must be a function.');
  }
  if (extractors !== undefined) {
    if (typeof extractors !== 'object' || extractors === null) {
      throw DslError.of('invalidArgument', 'The extractors option must be an object.');
    }
    for (const [kind, extractor] of Object.entries(extractors)) {
      if (typeof extractor !== 'function') {
        throw DslError.of('invalidArgument', `The extractor ${kind} must be a function.`);
      }
    }
  }
  return config;
}

function checkOptions(
  options: ArticleOptions | undefined,
  extractors: Readonly<Record<string, Extractor>>,
): ResolvedArticleOptions & { readonly kind?: string } {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw DslError.of('invalidArgument', 'The article options must be an object.');
  }
  for (const key of Object.keys(options ?? {})) {
    if (!OPTION_KEYS.has(key)) {
      throw DslError.of('invalidArgument', `The article plugin has no option ${key}.`);
    }
  }
  const {
    labels = 'expand',
    stress = 'none',
    secondary = true,
    splitTranslations = true,
    kind,
  } = options ?? {};
  if (labels !== 'expand' && labels !== 'keep') {
    throw DslError.of('invalidArgument', 'The labels option must be "expand" or "keep".');
  }
  if (stress !== 'none' && stress !== 'combining') {
    throw DslError.of('invalidArgument', 'The stress option must be "none" or "combining".');
  }
  if (typeof secondary !== 'boolean' || typeof splitTranslations !== 'boolean') {
    throw DslError.of(
      'invalidArgument',
      'The secondary and splitTranslations options must be booleans.',
    );
  }
  if (kind !== undefined && typeof extractors[kind] !== 'function') {
    throw DslError.of('invalidArgument', `The article plugin has no extractor ${kind}.`);
  }
  const resolved = { labels, stress, secondary, splitTranslations };
  return kind === undefined ? resolved : { ...resolved, kind };
}

/**
 * The `article` plugin: a semantic projection of each entry (see `Article`), with the
 * built-in classifier and extractors. Experimental: the format may change in a minor
 * version (`ARTICLE_VERSION`).
 *
 * @example
 * ```ts
 * import { parseDsl } from 'dsl-dicts';
 * import { article } from 'dsl-dicts/article';
 *
 * for await (const { headwords, senses } of parseDsl(bytes).entries({ plugin: article })) …
 * ```
 *
 * @experimental
 */
export const article: DslPlugin<Article, ArticleOptions | undefined> = createArticlePlugin();
