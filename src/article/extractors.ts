/**
 * The built-in extractors: one strategy per shape of entry (see `ArticleKind`).
 *
 * @packageDocumentation
 */

import type { MarkupNode } from '../index.js';
import type { ExtractionContext } from './context.js';
import { type Paragraph, type ReadMode, readParagraphs, takeTranscriptions } from './paragraph.js';
import { MARKER_RANK } from './text.js';
import type { ArticleContent, Example, Label, Media, Reference, Sense } from './types.js';

/**
 * Builds the content of an article from a body (or a sub-entry's content), for one shape of
 * entry. Sub-entries are not its concern: the plugin builds them as articles of their own.
 * Must not mutate the body; should not throw.
 *
 * @experimental
 */
export type Extractor = (body: readonly MarkupNode[], context: ExtractionContext) => ArticleContent;

interface MutableSense {
  number?: string;
  labels: Label[];
  translations: string[];
  examples: Example[];
  comments: string[];
  references: Reference[];
  senses: MutableSense[];
  notes: string[];
}

interface MutableContent {
  transcriptions: string[];
  media: Media[];
  labels: Label[];
  senses: MutableSense[];
  references: Reference[];
  comments: string[];
  notes: string[];
}

/** Where content goes: a sense, or the article itself. */
type Target = MutableSense | MutableContent;

/** An open sense, with what decides where the next senses go. */
interface Frame {
  readonly sense: MutableSense;
  /** The rank of its numbering style (`MARKER_RANK`); unnumbered senses are innermost. */
  readonly rank: number;
  /** The `[m]` level of the paragraph that opened it. */
  readonly level: number;
}

const UNNUMBERED = 4;

function emptyContent(): MutableContent {
  return {
    transcriptions: [],
    media: [],
    labels: [],
    senses: [],
    references: [],
    comments: [],
    notes: [],
  };
}

function newSense(number?: string): MutableSense {
  const sense: MutableSense = {
    labels: [],
    translations: [],
    examples: [],
    comments: [],
    references: [],
    senses: [],
    notes: [],
  };
  if (number !== undefined) sense.number = number;
  return sense;
}

/** A sense that has nothing of its own yet but labels: the next translation fills it. */
function isOpenForContent(sense: MutableSense): boolean {
  return (
    sense.translations.length === 0 && sense.examples.length === 0 && sense.senses.length === 0
  );
}

function add(target: Target, paragraph: Paragraph, notes: readonly string[]): void {
  target.labels.push(...paragraph.labels);
  if ('translations' in target) {
    target.translations.push(...paragraph.translations);
    target.examples.push(...paragraph.examples);
  }
  target.comments.push(...paragraph.comments);
  target.references.push(...paragraph.references);
  target.notes.push(...notes);
}

/** Builds the sense tree from paragraphs: see the rules of `extractZoneMarked`. */
function buildTree(paragraphs: readonly Paragraph[]): ArticleContent {
  const article = emptyContent();
  const stack: Frame[] = [];
  let started = false;
  let fresh = false;
  let heading: { text: string; used: boolean; target: Target } | undefined;

  const top = (): Frame | undefined => stack.at(-1);
  const open = (sense: MutableSense, rank: number, level: number): MutableSense => {
    const parent = top();
    (parent === undefined ? article.senses : parent.sense.senses).push(sense);
    stack.push({ sense, rank, level });
    started = true;
    fresh = false;
    return sense;
  };
  const openUnnumbered = (level: number): MutableSense => {
    while ((top()?.level ?? -1) >= level) stack.pop();
    return open(newSense(), UNNUMBERED, level);
  };
  const flushHeading = (): void => {
    if (heading !== undefined && !heading.used) heading.target.notes.push(`${heading.text}:`);
    heading = undefined;
  };

  for (const paragraph of paragraphs) {
    article.transcriptions.push(...paragraph.transcriptions);
    article.media.push(...paragraph.media);
    if (paragraph.separator) {
      flushHeading();
      while ((top()?.level ?? -1) >= paragraph.level) stack.pop();
      fresh = true;
      continue;
    }
    if (paragraph.heading !== undefined) {
      flushHeading();
      heading = { text: paragraph.heading, used: false, target: top()?.sense ?? article };
      continue;
    }
    if (heading !== undefined) {
      if (paragraph.references.length > 0) {
        for (const reference of paragraph.references) reference.label ??= heading.text;
        heading.used = true;
      } else {
        flushHeading();
      }
    }

    const { marker, level } = paragraph;
    const current = top();
    let target: Target;
    if (marker !== undefined) {
      const rank = MARKER_RANK[marker.style];
      for (let frame = top(); frame !== undefined; frame = top()) {
        if (frame.rank > rank || (frame.rank === rank && frame.level >= level)) stack.pop();
        else break;
      }
      target = open(newSense(marker.value), rank, level);
    } else if (paragraph.translations.length > 0) {
      target =
        current !== undefined && !fresh && isOpenForContent(current.sense)
          ? current.sense
          : openUnnumbered(level);
    } else if (paragraph.examples.length > 0) {
      target = current !== undefined && !fresh ? current.sense : openUnnumbered(level);
    } else if (paragraph.labels.length > 0 && paragraph.references.length === 0) {
      if (current !== undefined && !fresh && isOpenForContent(current.sense))
        target = current.sense;
      else if (!started) target = article;
      else target = openUnnumbered(level);
    } else {
      target = current?.sense ?? article;
    }
    // Bracketed text outside zones, before the first sense or on a line of its own, is a
    // transcription: `[ˈkʌlə]`.
    const notes =
      target === article || !paragraph.inMargin
        ? takeTranscriptions(paragraph.notes, article.transcriptions)
        : paragraph.notes;
    add(target, paragraph, notes);
  }
  flushHeading();
  return finish(article);
}

/** Leaves out empty notes. */
function finish(content: MutableContent): ArticleContent {
  const out: { -readonly [K in keyof ArticleContent]: ArticleContent[K] } = {
    transcriptions: content.transcriptions,
    media: content.media,
    labels: content.labels,
    senses: content.senses.map(finishSense),
    references: content.references,
    comments: content.comments,
  };
  if (content.notes.length > 0) out.notes = content.notes;
  return out;
}

function finishSense(sense: MutableSense): Sense {
  const body = {
    labels: sense.labels,
    translations: sense.translations,
    examples: sense.examples,
    comments: sense.comments,
    references: sense.references,
    senses: sense.senses.map(finishSense),
  };
  const out: Sense = sense.number === undefined ? body : { number: sense.number, ...body };
  return sense.notes.length > 0 ? { ...out, notes: sense.notes } : out;
}

function structured(mode: ReadMode): Extractor {
  return (body, context) => buildTree(readParagraphs(body, context, mode));
}

/**
 * The extractor of `zone-marked` entries: zones give the meaning of text (`[trn]`
 * translations, `[ex]` examples, `[com]` comments, `[p]` labels, `[t]` transcriptions),
 * paragraphs (`[m]` tags, and lines outside them) and numbering give the sense tree. Text
 * outside zones is a note, except numbering, punctuation, link labels and transcriptions.
 *
 * The sense tree:
 * - A paragraph that starts with a number (`I`, `1.`, `1)`, `а)`) opens a sense. Numbering
 *   styles nest in that order, whatever the `[m]` levels: `I` holds `1.`, which holds `1)`,
 *   which holds `а)`; a style already open closes the senses up to its sibling.
 * - A paragraph with translations and no number fills the open sense if it has nothing yet
 *   (`1.` on a line, its translation on the next), or else opens an unnumbered sense: inside
 *   the open sense if the paragraph is deeper (a higher `[m]` level), beside it otherwise.
 * - Examples, comments, links and notes go to the open sense; examples with no sense open
 *   open an unnumbered one. Before the first sense, labels, comments, links and notes are
 *   the entry's, and so is bracketed text (`[ˈkʌlə]`), as a transcription.
 * - A paragraph of labels only, after senses with content, opens an unnumbered sense: a
 *   group, such as another part of speech.
 * - A paragraph of punctuation only (`•`) closes the senses of its level and deeper: what
 *   follows (idioms, phrasal verbs) is a new section.
 * - A heading (`Syn:`) labels the links of the paragraphs that follow it.
 *
 * @experimental
 */
export const extractZoneMarked: Extractor = structured('zones');

/**
 * The extractor of `layout-only` entries: the same sense tree as `zone-marked`, but text
 * outside zones is a translation, or an example when it is in `[lang]` or has a spaced dash
 * (`phrase — translation`).
 *
 * @experimental
 */
export const extractLayoutOnly: Extractor = structured('layout');

/**
 * The extractor of `plain` entries, as dsl-dicts 1.x read them: one unnumbered sense whose
 * translations are the lines of the body (split at semicolons, like any translation).
 * Labels, links and media are taken out as usual.
 *
 * @experimental
 */
export const extractPlain: Extractor = (body, context) => {
  const article = emptyContent();
  const sense = newSense();
  for (const paragraph of readParagraphs(body, context, 'plain')) {
    article.transcriptions.push(...paragraph.transcriptions);
    article.media.push(...paragraph.media);
    add(sense, paragraph, paragraph.notes);
  }
  if (sense.translations.length > 0 || sense.examples.length > 0) article.senses.push(sense);
  else {
    article.labels.push(...sense.labels);
    article.comments.push(...sense.comments);
    article.references.push(...sense.references);
    article.notes.push(...sense.notes);
  }
  return finish(article);
};

/**
 * The extractor of `reference-only` entries (`см. <<other>>`): the same reading as
 * `zone-marked`. The links, with the short text before each as their label, are the
 * article's references, or those of its senses when the entry numbers them (homonyms that
 * point to different entries).
 *
 * @experimental
 */
export const extractReferenceOnly: Extractor = structured('zones');

/**
 * The extractor of `media-only` entries: the same reading as `zone-marked`; the media files,
 * with their labels, are the article's.
 *
 * @experimental
 */
export const extractMediaOnly: Extractor = structured('zones');

/**
 * The built-in extractors, by the kind they build.
 *
 * @experimental
 */
export const DEFAULT_EXTRACTORS: Readonly<
  Record<'zone-marked' | 'layout-only' | 'plain' | 'reference-only' | 'media-only', Extractor>
> = Object.freeze({
  'zone-marked': extractZoneMarked,
  'layout-only': extractLayoutOnly,
  plain: extractPlain,
  'reference-only': extractReferenceOnly,
  'media-only': extractMediaOnly,
});
