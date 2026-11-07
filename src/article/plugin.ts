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
import type { Article, ArticleKind, Example, Media, Sense } from './types.js';

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
export interface ArticlePluginOptions {
  /**
   * Include the labels (`[p]`): `Article.labels`, `Sense.labels`, `Example.labels` and
   * `Media.label`. Default `true`. Left out, labels are still recognized, so that their text
   * never ends up in translations or notes; the arrays are then empty.
   */
  readonly labels?: boolean;
  /**
   * Give each label its `expansion` from the dictionary's abbreviations
   * (`DictionaryContext.abbreviations`), when there are some. Default `true`: an expansion
   * is added next to the label as written, which is always kept.
   */
  readonly expandLabels?: boolean;
  /** How `[']` stresses are rendered in texts; see `ToPlainTextOptions.stress`. Default `none`. */
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
  /**
   * The version of the plugin's output format, recorded with exports. Default
   * `ARTICLE_VERSION`; a customized plugin whose output differs should have its own.
   */
  readonly version?: string;
  /** Picks the extractor of each entry and sub-entry. Default `classifyBody`. */
  readonly classify?: Classifier;
  /**
   * Extractors by kind, added to the built-in ones (`DEFAULT_EXTRACTORS`) or replacing
   * them. A classifier may return the name of any of them.
   */
  readonly extractors?: Readonly<Record<string, Extractor>>;
}

const OPTION_KEYS = new Set([
  'labels',
  'expandLabels',
  'stress',
  'secondary',
  'splitTranslations',
  'kind',
]);
const CONFIG_KEYS = new Set(['name', 'version', 'classify', 'extractors']);

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
 *   version: '1.0.0',
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
): DslPlugin<Article, ArticlePluginOptions | undefined> {
  const {
    name = 'article',
    version = ARTICLE_VERSION,
    classify = classifyBody,
    extractors = {},
  } = checkConfig(config);
  const table: Readonly<Record<string, Extractor>> = { ...DEFAULT_EXTRACTORS, ...extractors };
  return definePlugin({
    name,
    version,
    setup(dictionary, options: ArticlePluginOptions | undefined) {
      const { kind: forced, ...resolved } = checkOptions(options, table);
      return (entry): Article => {
        const tilde = entry.headwords[0]?.variants[0];
        const read = (body: readonly MarkupNode[], headwords: readonly Headword[]): Article => {
          const context: ExtractionContext = { dictionary, options: resolved, headwords, tilde };
          const kind = forced ?? classify(body, context);
          const extractor = table[kind];
          if (typeof extractor !== 'function') {
            throw new DslError('DSL0001', `The article plugin has no extractor ${kind}.`);
          }
          const { notes, ...content } = extractor(body, context);
          const article: { -readonly [K in keyof Article]: Article[K] } = {
            kind,
            headwords: headwords.map((h) => ({ text: h.text, variants: [...h.variants] })),
            ...content,
            subentries: subentriesOf(body).map((s) => read(s.children, s.headwords)),
          };
          if (notes !== undefined && notes.length > 0) article.notes = notes;
          return resolved.labels ? article : withoutLabels(article);
        };
        return read(entry.body, entry.headwords);
      };
    },
  });
}

/** An article without labels: the `labels` option is off. Sub-entries are already done. */
function withoutLabels(article: Article): Article {
  const sense = (s: Sense): Sense => ({
    ...s,
    labels: [],
    examples: s.examples.map(example),
    senses: s.senses.map(sense),
  });
  const example = ({ labels: _labels, ...rest }: Example): Example => rest;
  const media = ({ label: _label, ...rest }: Media): Media => rest;
  return {
    ...article,
    media: article.media.map(media),
    labels: [],
    senses: article.senses.map(sense),
  };
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
    throw new DslError('DSL0001', 'The article plugin configuration must be an object.');
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new DslError('DSL0001', `The article plugin has no configuration ${key}.`);
    }
  }
  const { classify, extractors } = config;
  if (classify !== undefined && typeof classify !== 'function') {
    throw new DslError('DSL0001', 'The classify option must be a function.');
  }
  if (extractors !== undefined) {
    if (typeof extractors !== 'object' || extractors === null) {
      throw new DslError('DSL0001', 'The extractors option must be an object.');
    }
    for (const [kind, extractor] of Object.entries(extractors)) {
      if (typeof extractor !== 'function') {
        throw new DslError('DSL0001', `The extractor ${kind} must be a function.`);
      }
    }
  }
  return config;
}

function checkOptions(
  options: ArticlePluginOptions | undefined,
  extractors: Readonly<Record<string, Extractor>>,
): ResolvedArticleOptions & { readonly kind?: string } {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new DslError('DSL0001', 'The article options must be an object.');
  }
  for (const key of Object.keys(options ?? {})) {
    if (!OPTION_KEYS.has(key)) {
      throw new DslError('DSL0001', `The article plugin has no option ${key}.`);
    }
  }
  const {
    labels = true,
    expandLabels = true,
    stress = 'none',
    secondary = true,
    splitTranslations = true,
    kind,
  } = options ?? {};
  if (typeof labels !== 'boolean' || typeof expandLabels !== 'boolean') {
    throw new DslError('DSL0001', 'The labels and expandLabels options must be booleans.');
  }
  if (stress !== 'none' && stress !== 'combining') {
    throw new DslError('DSL0001', 'The stress option must be "none" or "combining".');
  }
  if (typeof secondary !== 'boolean' || typeof splitTranslations !== 'boolean') {
    throw new DslError('DSL0001', 'The secondary and splitTranslations options must be booleans.');
  }
  if (kind !== undefined && typeof extractors[kind] !== 'function') {
    throw new DslError('DSL0001', `The article plugin has no extractor ${kind}.`);
  }
  const resolved = { labels, expandLabels, stress, secondary, splitTranslations };
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
export const article: DslPlugin<Article, ArticlePluginOptions | undefined> = createArticlePlugin();
