/**
 * The article model: what the `article` plugin makes of an entry.
 *
 * Plain data only, JSON-serializable by construction: strings, arrays and plain objects, no
 * `undefined` values (optional fields are left out instead).
 *
 * @packageDocumentation
 */

/**
 * The shape of an entry, as the classifier sees it, and so the extractor that built the
 * article (see `classifyBody`):
 * - `zone-marked`: the body marks its content with zones (`[trn]`, `[ex]`, `[com]`);
 * - `layout-only`: paragraphs (`[m]`) and numbering, but no zones;
 * - `plain`: neither zones nor paragraphs, such as a body of plain text lines;
 * - `reference-only`: links to other entries (`<<...>>`, `[ref]`, `[url]`) with nothing
 *   else but labels and comments, such as `[p]уменьш.[/p] от [ref]...[/ref]`;
 * - `media-only`: media files (`[s]`, `[video]`) with nothing else but labels.
 *
 * A custom classifier may return the name of a custom extractor (see
 * `ArticlePluginConfig.extractors`): any other string.
 *
 * @experimental
 */
export type ArticleKind =
  | 'zone-marked'
  | 'layout-only'
  | 'plain'
  | 'reference-only'
  | 'media-only'
  | (string & {});

/**
 * A headword of the article: `Headword.text` (as shown) and `Headword.variants` (the index
 * forms).
 *
 * @experimental
 */
export interface ArticleHeadword {
  readonly text: string;
  readonly variants: string[];
}

/**
 * A label (`[p]`): a part of speech, a register, a domain, a grammatical note.
 *
 * @experimental
 */
export interface Label {
  /** The label as written, whitespace collapsed: `n`, `разг.`. */
  readonly text: string;
  /**
   * What the label stands for, from the dictionary's abbreviations (`_abrv.dsl`, see
   * `DictionaryContext.abbreviations`): absent if there are none, the label is not one of
   * them, or the plugin option `labels` is `keep`.
   */
  readonly expansion?: string;
}

/**
 * A media file (`[s]`, `[video]`).
 *
 * @experimental
 */
export interface Media {
  /** The file name as written. */
  readonly file: string;
  /**
   * What the file is, by its extension: `wav`, `mp3`, `ogg`... are `sound`; `bmp`, `jpg`,
   * `png`... are `image`; `avi`, `mp4`... are `video`; anything else is `other` (`video` for
   * an unknown extension in a `[video]` tag).
   */
  readonly type: 'sound' | 'image' | 'video' | 'other';
  /**
   * The label written just before the file, such as the variety of a pronunciation (`брит.`
   * before one sound, `амер.` before another).
   */
  readonly label?: Label;
}

/**
 * A link to another entry (`<<target>>`, `[ref]target[/ref]`) or an address (`[url]`).
 *
 * @experimental
 */
export interface Reference {
  /** The headword (or the address) the link points to. */
  readonly target: string;
  /** `[ref dict="..."]`: the dictionary of the target entry. */
  readonly dictionary?: string;
  /** The text shown for the link, when it differs from the target (`[ref target="..."]`). */
  readonly text?: string;
  /**
   * What the link means, when the dictionary says it: a short text just before it (`см.`,
   * `=`), or the heading of the list it is in (`Syn`, `Ant`, without the colon).
   */
  readonly label?: string;
  /** The sense of the target entry, when a number follows the link: `2`, `1)`. */
  readonly sense?: string;
  /** The link is an address (`[url]`), not a headword. */
  readonly external?: true;
}

/**
 * One side of an example.
 *
 * @experimental
 */
export interface ExampleText {
  readonly text: string;
  /**
   * The Lingvo name of the language (`English`): of the source, from its `[lang]` tag, or
   * else the dictionary's index language; of the target, the dictionary's contents language.
   * Absent if unknown.
   */
  readonly language?: string;
}

/**
 * A usage example (`[ex]`): a phrase in the source language and its translation, usually
 * written `[lang id=1033]source[/lang] — target`.
 *
 * @experimental
 */
export interface Example {
  readonly source: ExampleText;
  /** The translation, after the dash (`—`, `–`, ` - `, or `≈`, which it keeps); may be absent. */
  readonly target?: ExampleText;
  /** Labels of the example, such as `посл.` (a proverb) before or just after the dash. */
  readonly labels?: Label[];
}

/**
 * A sense of the headword: a numbered or unnumbered meaning, possibly with sub-senses.
 *
 * @experimental
 */
export interface Sense {
  /**
   * The number or letter the dictionary gives the sense, without punctuation: `1` for `1)`
   * and `1.`, `а` for `а)`, `II` for a homonym `II`. Absent for an unnumbered sense.
   */
  readonly number?: string;
  readonly labels: Label[];
  /**
   * The translations (`[trn]`), without labels and comments: the text of the zone split at
   * semicolons outside brackets (`a, b; c` gives `a, b` and `c`), unless the plugin option
   * `splitTranslations` is `false`.
   */
  readonly translations: string[];
  readonly examples: Example[];
  /** Comments (`[com]`), without the parentheses that enclose a whole comment. */
  readonly comments: string[];
  readonly references: Reference[];
  readonly senses: Sense[];
  /**
   * Text of the sense that is in no zone and could not be placed, such as grammatical
   * government outside the translation (`(an A)`). Absent if none.
   */
  readonly notes?: string[];
}

/**
 * The article: a heuristic semantic projection of an entry. DSL describes the layout of a
 * card, not its meaning, so this is a best effort, which may differ between dictionaries;
 * the AST (`DslEntry.body`) is the exact representation.
 *
 * @experimental The format may change in a minor version; `ARTICLE_VERSION` tells which one
 * a result follows.
 */
export interface Article {
  /** The shape of the entry and the extractor that built the article. */
  readonly kind: ArticleKind;
  readonly headwords: ArticleHeadword[];
  /** Transcriptions (`[t]`, or a bracketed `[...]` before the first sense), as written. */
  readonly transcriptions: string[];
  /** Media files, wherever they are in the entry. */
  readonly media: Media[];
  /** Labels of the entry: those before the first sense, such as the part of speech. */
  readonly labels: Label[];
  /** The senses, in order, nested by their numbering and paragraph levels. */
  readonly senses: Sense[];
  /** Links of the entry as a whole: before the first sense, or after a section separator. */
  readonly references: Reference[];
  /** Comments of the entry as a whole, such as grammatical forms before the first sense. */
  readonly comments: string[];
  /** The sub-entries (`@ headword` ... `@`), as articles of their own. */
  readonly subentries: Article[];
  /**
   * Text of the entry as a whole that is in no zone and could not be placed. Absent if none.
   * Together with `Sense.notes`, nothing of the body is silently dropped but punctuation,
   * numbering and whitespace.
   */
  readonly notes?: string[];
}

/**
 * What an extractor builds: the article without its kind, headwords and sub-entries, which
 * the plugin adds.
 *
 * @experimental
 */
export type ArticleContent = Omit<Article, 'kind' | 'headwords' | 'subentries'>;
