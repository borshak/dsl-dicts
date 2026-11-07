/**
 * Reading a body as paragraphs: the first step of every built-in extractor.
 *
 * DSL marks layout, and zones and formatting cross each other freely (`[trn][i]...[/trn][/i]`
 * is typical), so the tree is first flattened into atoms: pieces of text, links, media and
 * line breaks, each with the zones it is in. Each paragraph (an `[m]` tag, or a line outside
 * them) is then analyzed into its parts: numbering, labels, translations, examples,
 * comments, links, notes.
 *
 * @packageDocumentation
 */

import {
  findLanguageById,
  type MarkupNode,
  normalizeLabel,
  resolveLanguageName,
  type TagNode,
  toPlainText,
} from '../index.js';
import type { ExtractionContext } from './context.js';
import {
  bracketedTranscriptions,
  collapse,
  findMarker,
  headingText,
  isLinkPrefix,
  isSenseNumber,
  isTrivial,
  type Marker,
  mediaType,
  splitOutsideBrackets,
  stripEnclosingParentheses,
  trimSeparators,
} from './text.js';
import type { Example, Label, Media, Reference } from './types.js';

/** What a piece of text is, by the zones it is in: an example wins over a label, and so on. */
type Role = 'example' | 'label' | 'comment' | 'translation' | 'text';

/** The zones an atom is in. Zone ids tell tag instances apart; 0 means outside. */
interface Scope {
  readonly trn: boolean;
  readonly ex: number;
  readonly com: number;
  readonly label: number;
  /** Lingvo name of the language of the innermost `[lang]`, if it names a known one. */
  readonly language: string | undefined;
  readonly inLang: boolean;
  readonly bold: boolean;
}

interface Atom extends Scope {
  readonly kind: 'text' | 'link' | 'media' | 'transcription' | 'break';
  readonly role: Role;
  text: string;
  readonly reference?: Reference;
  readonly tag?: string;
}

const ROOT: Scope = {
  trn: false,
  ex: 0,
  com: 0,
  label: 0,
  language: undefined,
  inLang: false,
  bold: false,
};

/** A paragraph of a body: an `[m]` tag, or a line outside them. */
interface RawParagraph {
  /** The `[m]` level; 0 for a line outside `[m]`. */
  readonly level: number;
  readonly inMargin: boolean;
  readonly atoms: Atom[];
}

/**
 * How a paragraph is read: `zones` (text outside zones is a note), `layout` (text outside
 * zones is a translation, or an example when it looks like one), `plain` (the same, without
 * numbering).
 */
export type ReadMode = 'zones' | 'layout' | 'plain';

/** A reference being built: its label and sense are found after the link itself. */
type MutableReference = { -readonly [K in keyof Reference]: Reference[K] };

/** What a paragraph holds. */
export interface Paragraph {
  readonly level: number;
  readonly inMargin: boolean;
  readonly marker?: Marker;
  /** Only punctuation, such as `•`: it separates sections of the entry. */
  readonly separator: boolean;
  /** Only a heading such as `Syn:`, for the links that follow (without the colon). */
  readonly heading?: string;
  readonly labels: Label[];
  readonly translations: string[];
  readonly examples: Example[];
  readonly comments: string[];
  readonly references: MutableReference[];
  readonly transcriptions: string[];
  readonly media: Media[];
  readonly notes: string[];
}

/** Reads a body (or a sub-entry's content) as paragraphs. Sub-entries are left out. */
export function readParagraphs(
  body: readonly MarkupNode[],
  context: ExtractionContext,
  mode: ReadMode,
): Paragraph[] {
  return new Reader(context).paragraphs(body).map((p) => analyze(p, context, mode));
}

class Reader {
  private id = 0;
  constructor(private readonly context: ExtractionContext) {}

  paragraphs(body: readonly MarkupNode[]): RawParagraph[] {
    const out: RawParagraph[] = [];
    let line: Atom[] = [];
    const flush = (): void => {
      if (line.length > 0) out.push({ level: 0, inMargin: false, atoms: line });
      line = [];
    };
    for (const node of body) {
      if (node.type === 'tag' && node.name === 'm') {
        flush();
        const atoms: Atom[] = [];
        this.flatten(node.children, ROOT, atoms);
        out.push({ level: node.attrs.level ?? 0, inMargin: true, atoms });
      } else if (node.type === 'lineBreak' || node.type === 'subentry') {
        flush();
      } else {
        this.flatten([node], ROOT, line);
      }
    }
    flush();
    return out;
  }

  private flatten(nodes: readonly MarkupNode[], scope: Scope, out: Atom[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out.push(textAtom(node.text, scope));
          break;
        case 'tilde':
          out.push(textAtom(this.render([node]), scope));
          break;
        case 'lineBreak':
          out.push({ ...scope, kind: 'break', role: roleOf(scope), text: ' ' });
          break;
        case 'link':
          this.link(this.render(node.children), { target: '' }, scope, out);
          break;
        case 'subentry':
          break;
        case 'tag':
          this.tag(node, scope, out);
          break;
      }
    }
  }

  private tag(node: TagNode, scope: Scope, out: Atom[]): void {
    const { options } = this.context;
    switch (node.name) {
      case 't':
        out.push({ ...scope, kind: 'transcription', role: 'text', text: this.render([node]) });
        return;
      case 's':
      case 'video':
        out.push({
          ...scope,
          kind: 'media',
          role: 'text',
          text: toPlainText(node.children),
          tag: node.name,
        });
        return;
      case 'ref': {
        const shown = this.render(node.children);
        const target = node.attrs.target ?? shown;
        const reference: MutableReference = { target };
        if (node.attrs.dict !== undefined) reference.dictionary = node.attrs.dict;
        if (shown !== target && shown.length > 0) reference.text = shown;
        this.link(target, reference, scope, out, shown);
        return;
      }
      case 'url': {
        const shown = this.render(node.children);
        const target = node.attrs.target ?? shown;
        const reference: MutableReference = { target, external: true };
        if (shown !== target && shown.length > 0) reference.text = shown;
        this.link(target, reference, scope, out, shown);
        return;
      }
      case 'p':
        this.flatten(node.children, { ...scope, label: ++this.id }, out);
        return;
      case 'trn':
      case 'trn1':
        this.flatten(node.children, { ...scope, trn: true }, out);
        return;
      case 'ex':
        this.flatten(node.children, { ...scope, ex: ++this.id }, out);
        return;
      case 'com':
        this.flatten(node.children, { ...scope, com: ++this.id }, out);
        return;
      case 'lang':
        this.flatten(node.children, { ...scope, inLang: true, language: language(node) }, out);
        return;
      case 'b':
        this.flatten(node.children, { ...scope, bold: true }, out);
        return;
      case '*':
        if (options.secondary) this.flatten(node.children, scope, out);
        return;
      case "'":
        if (options.stress === 'combining') out.push(textAtom(this.render([node]), scope));
        else this.flatten(node.children, scope, out);
        return;
      default:
        this.flatten(node.children, scope, out);
    }
  }

  /** A link: in an example it is part of the text, elsewhere a reference. */
  private link(
    target: string,
    reference: MutableReference,
    scope: Scope,
    out: Atom[],
    shown = target,
  ): void {
    if (scope.ex !== 0) {
      out.push(textAtom(shown, scope));
      return;
    }
    const trimmed = collapse(target);
    if (trimmed.length === 0) return;
    out.push({
      ...scope,
      kind: 'link',
      role: 'text',
      text: shown,
      reference: { ...reference, target: trimmed },
    });
  }

  private render(nodes: readonly MarkupNode[]): string {
    const { tilde, options } = this.context;
    return toPlainText(nodes, { tilde, stress: options.stress, media: true }).replace(/\n/g, ' ');
  }
}

function textAtom(text: string, scope: Scope): Atom {
  return { ...scope, kind: 'text', role: roleOf(scope), text };
}

function roleOf(scope: Scope): Role {
  if (scope.ex !== 0) return 'example';
  if (scope.label !== 0) return 'label';
  if (scope.com !== 0) return 'comment';
  return scope.trn ? 'translation' : 'text';
}

/** The Lingvo name of the language of a `[lang]` tag, if it names a known one. */
function language(node: TagNode): string | undefined {
  const { id, name } = node.attrs;
  if (id !== undefined) return findLanguageById(id)?.name;
  if (name !== undefined) return resolveLanguageName(name)?.language.name;
  return undefined;
}

// --- Analysis -------------------------------------------------------------------------------

/**
 * Atoms grouped by what they make: a run of text outside zones (with the labels in it), a
 * comment, an example, a label of a translation, a piece of translation, a line break, a
 * link, a media file, a transcription.
 */
interface Item {
  readonly type:
    | 'run'
    | 'comment'
    | 'example'
    | 'label'
    | 'translation'
    | 'break'
    | 'link'
    | 'media'
    | 'transcription';
  readonly atoms: Atom[];
}

/** A run of text with labels: the labels at its ends, and the text between them. */
interface Split {
  readonly leading: Atom[][];
  readonly middle: string;
  readonly trailing: Atom[][];
}

function isBlank(atom: Atom): boolean {
  return atom.kind === 'text' && atom.text.trim().length === 0;
}

/** Which item an atom belongs to. */
function itemType(atom: Atom): Item['type'] {
  switch (atom.kind) {
    case 'link':
    case 'media':
    case 'transcription':
      return atom.kind;
    case 'break':
      return atom.role === 'example' ? 'example' : 'break';
    default:
      if (atom.role === 'example') return 'example';
      if (atom.role === 'comment') return 'comment';
      if (atom.role === 'translation') return 'translation';
      if (atom.role === 'label') {
        if (atom.com !== 0) return 'comment';
        return atom.trn ? 'label' : 'run';
      }
      return 'run';
  }
}

function group(atoms: readonly Atom[]): Item[] {
  const items: Item[] = [];
  for (const atom of atoms) {
    const type = itemType(atom);
    const last = items.at(-1);
    if (last !== undefined && last.type === type && joins(type, last.atoms, atom)) {
      last.atoms.push(atom);
    } else if (
      type === 'example' &&
      last?.type === 'run' &&
      last.atoms.every(isBlank) &&
      items.at(-2)?.type === 'example' &&
      !hasSeparator(items.at(-2)?.atoms ?? [])
    ) {
      // An example split by crossing tags, with only spaces between the parts.
      const blank = items.pop() as Item;
      items.at(-1)?.atoms.push(...blank.atoms, atom);
    } else {
      items.push({ type, atoms: [atom] });
    }
  }
  return items;
}

function joins(type: Item['type'], atoms: Atom[], atom: Atom): boolean {
  const last = atoms.at(-1) as Atom;
  switch (type) {
    case 'run':
    case 'translation':
      return true;
    case 'comment':
      // Comment tags split by crossing tags are adjacent; separate comments are not (text
      // between them makes another item).
      return true;
    case 'label':
      return last.label === atom.label;
    case 'example':
      return last.ex === atom.ex || !hasSeparator(atoms);
    default:
      return false;
  }
}

/**
 * Splits a run (of text and labels) into the labels at its ends and the text between. A
 * label inside brackets (`(an [p]A[/p])`) or between pieces of text is part of the text;
 * punctuation next to the text is kept with it, separators (`,`, `;`) at its ends are not.
 */
function split(atoms: readonly Atom[]): Split {
  const inline = new Set<Atom>();
  let depth = 0;
  for (const atom of atoms) {
    if (atom.role === 'label' && depth > 0) inline.add(atom);
    for (const char of atom.text) {
      if (char === '(' || char === '[') depth++;
      else if ((char === ')' || char === ']') && depth > 0) depth--;
    }
  }
  const isLabel = (a: Atom): boolean => a.role === 'label' && !inline.has(a);
  const content = (a: Atom): boolean => !isLabel(a) && !isTrivial(a.text);
  let first = atoms.findIndex(content);
  // Labels only: they come before what follows (a media file takes the last one).
  if (first < 0) return { leading: [], middle: '', trailing: labelGroups(atoms.filter(isLabel)) };
  let last = atoms.findLastIndex(content);
  while (first > 0 && !isLabel(atoms[first - 1] as Atom)) first--;
  while (last < atoms.length - 1 && !isLabel(atoms[last + 1] as Atom)) last++;
  const middle = trimSeparators(collapse(text(atoms.slice(first, last + 1))));
  return {
    leading: labelGroups(atoms.slice(0, first).filter(isLabel)),
    middle: isTrivial(middle) ? '' : middle,
    trailing: labelGroups(atoms.slice(last + 1).filter(isLabel)),
  };
}

/** A symbol that ends a run of punctuation just before a link: `= [ref]x[/ref]`. */
function linkSymbol(atoms: readonly Atom[]): string | undefined {
  const tail = /([=≈→⇒≠<>~+]+)[\s,;]*$/.exec(text(atoms.filter((a) => a.role !== 'label')));
  return tail?.[1];
}

/** Label atoms, one group per `[p]` tag. */
function labelGroups(atoms: readonly Atom[]): Atom[][] {
  const groups: Atom[][] = [];
  for (const atom of atoms) {
    const last = groups.at(-1);
    if (last !== undefined && last.at(-1)?.label === atom.label) last.push(atom);
    else groups.push([atom]);
  }
  return groups;
}

/** Analyzes a paragraph. */
function analyze(raw: RawParagraph, context: ExtractionContext, mode: ReadMode): Paragraph {
  const atoms = raw.atoms.map((a) => ({ ...a }));
  const marker = mode === 'plain' ? undefined : takeMarker(atoms);
  const items = group(atoms);
  const addLabel = (into: Label[], group: readonly Atom[]): void => {
    const found = label(group, context);
    if (found !== undefined) into.push(found);
  };

  const labels: Label[] = [];
  const comments: string[] = [];
  const examples: Example[] = [];
  const references: MutableReference[] = [];
  const transcriptions: string[] = [];
  const media: Media[] = [];
  const notes: string[] = [];
  const translationParts: string[] = [];
  /** Comments in a translation zone: the translation itself when the zone has nothing else. */
  const translationComments: string[] = [];

  // Runs and comments: labels at their ends, text between.
  const splits = new Map<Item, Split>();
  for (const item of items) {
    if (item.type === 'run' || item.type === 'comment') splits.set(item, split(item.atoms));
  }
  const consumed = new Set<Item>();

  // Links: the text just before can label them, a number just after gives the sense.
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Item;
    if (item.type !== 'link') continue;
    const reference = (item.atoms[0] as Atom).reference as MutableReference;
    references.push(reference);
    const before = items[i - 1];
    const prefix = before === undefined ? undefined : splits.get(before);
    if (before !== undefined && prefix !== undefined && !consumed.has(before)) {
      // A short text (`см.`), or a symbol (`=`), which is punctuation elsewhere.
      const symbol = prefix.middle.length === 0 ? linkSymbol(before.atoms) : undefined;
      if (symbol !== undefined) {
        reference.label = symbol;
      } else if (
        prefix.middle.length > 0 &&
        prefix.trailing.length === 0 &&
        isLinkPrefix(prefix.middle)
      ) {
        reference.label = prefix.middle;
        consumed.add(before);
      }
    }
    const after = items[i + 1];
    const suffix = after === undefined ? undefined : splits.get(after);
    if (
      after !== undefined &&
      suffix !== undefined &&
      suffix.leading.length === 0 &&
      isSenseNumber(suffix.middle)
    ) {
      reference.sense = suffix.middle;
      consumed.add(after);
    }
  }

  // Layout and plain text: text outside zones is a translation, or an example.
  const layout = mode !== 'zones';
  const exampleLike = layout && marker === undefined && looksLikeExample(atoms);

  let translationText = '';
  let lastTranslation = -2;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Item;
    switch (item.type) {
      case 'translation':
        translationText += (lastTranslation === i - 1 ? '' : ' ') + text(item.atoms);
        lastTranslation = i;
        break;
      case 'break':
        if (item.atoms.some((a) => a.trn)) translationText += ';';
        break;
      case 'label':
        addLabel(labels, item.atoms);
        break;
      case 'example': {
        const example = buildExample(item.atoms, context);
        if (example !== undefined) examples.push(example);
        break;
      }
      case 'transcription': {
        const value = collapse(text(item.atoms));
        if (value.length > 0) transcriptions.push(value);
        break;
      }
      case 'media': {
        const atom = item.atoms[0] as Atom;
        const file = atom.text.trim();
        if (file.length === 0) break;
        const entry: { -readonly [K in keyof Media]: Media[K] } = {
          file,
          type: mediaType(file, atom.tag ?? 's'),
        };
        // A label just before the file is the file's: `брит. [s]...[/s] / амер. [s]...[/s]`.
        const before = items[i - 1];
        const previous = before === undefined ? undefined : splits.get(before);
        const last = previous?.trailing.pop();
        const fileLabel = last === undefined ? undefined : label(last, context);
        if (fileLabel !== undefined) entry.label = fileLabel;
        media.push(entry);
        break;
      }
      case 'link':
        break;
      case 'run':
      case 'comment': {
        const parts = splits.get(item) as Split;
        if (consumed.has(item) || parts.middle.length === 0) break;
        if (item.type === 'comment') {
          const comment = stripEnclosingParentheses(parts.middle);
          if (isTrivial(comment)) break;
          comments.push(comment);
          if (item.atoms.every((a) => a.trn)) translationComments.push(comment);
        } else if (exampleLike) {
          const example = buildExample(item.atoms, context);
          if (example !== undefined) examples.push(example);
        } else if (layout) {
          translationParts.push(parts.middle);
        } else {
          notes.push(parts.middle);
        }
        break;
      }
    }
  }
  // Labels of runs and comments, after the media took theirs.
  const edgeLabels: Label[] = [];
  for (const item of items) {
    const parts = splits.get(item);
    if (parts === undefined) continue;
    for (const group of [...parts.leading, ...parts.trailing]) addLabel(edgeLabels, group);
  }
  labels.unshift(...edgeLabels);

  let translations = translationPieces(
    [translationText, ...translationParts],
    context.options.splitTranslations,
  );
  // `[trn][com]description[/com][/trn]`: a translation given as a description.
  if (translations.length === 0 && translationComments.length > 0) {
    translations = translationPieces(translationComments, context.options.splitTranslations);
    comments.splice(
      0,
      comments.length,
      ...comments.filter((c) => !translationComments.includes(c)),
    );
  }

  // A paragraph of punctuation only separates sections; one of a short text with a colon is
  // a heading.
  const empty =
    labels.length === 0 &&
    translations.length === 0 &&
    examples.length === 0 &&
    comments.length === 0 &&
    references.length === 0 &&
    transcriptions.length === 0 &&
    media.length === 0;
  const separator =
    empty && notes.length === 0 && marker === undefined && atoms.some((a) => !isBlank(a));
  const heading =
    empty && notes.length === 1 && marker === undefined
      ? headingText(notes[0] as string)
      : undefined;

  const paragraph = {
    level: raw.level,
    inMargin: raw.inMargin,
    separator,
    labels,
    translations,
    examples,
    comments,
    references,
    transcriptions,
    media,
    notes: heading === undefined ? notes : [],
  };
  return {
    ...paragraph,
    ...(marker === undefined ? {} : { marker }),
    ...(heading === undefined ? {} : { heading }),
  };
}

/** Takes the numbering marker off the first text of a paragraph, if it starts with one. */
function takeMarker(atoms: Atom[]): Marker | undefined {
  const first = atoms.find((a) => !isBlank(a));
  if (first === undefined || first.kind !== 'text' || first.role !== 'text') return undefined;
  const found = findMarker(first.text, first.bold);
  if (found !== undefined) first.text = first.text.slice(found.length);
  return found;
}

function text(atoms: readonly Atom[]): string {
  return atoms.map((a) => a.text).join('');
}

/** The label of a `[p]` tag's atoms; `undefined` if it is blank. */
function label(atoms: readonly Atom[], context: ExtractionContext): Label | undefined {
  const value = normalizeLabel(text(atoms));
  if (value.length === 0) return undefined;
  if (context.options.labels === 'keep') return { text: value };
  const expansion = context.dictionary.abbreviations?.get(value);
  return typeof expansion === 'string' ? { text: value, expansion } : { text: value };
}

/** The translations of a paragraph's translation texts. */
function translationPieces(texts: readonly string[], splitAtSemicolons: boolean): string[] {
  const out: string[] = [];
  for (const value of texts) {
    const pieces = splitAtSemicolons ? splitOutsideBrackets(value, ';') : [value];
    for (const piece of pieces) {
      const cleaned = trimSeparators(collapse(piece));
      if (!isTrivial(cleaned)) out.push(cleaned);
    }
  }
  return out;
}

// --- Examples -------------------------------------------------------------------------------

/** The separator of an example: a dash (`—`, `–`, or a spaced `-`), or `≈`. */
const SEPARATOR = /[—–≈]|(?<!\S)-(?!\S)/;
/** `≈` between spaces: some dictionaries put it, and the target, inside the `[lang]` tag. */
const APPROXIMATE = /(?<=\s)≈/;

interface Separator {
  readonly atom: number;
  readonly index: number;
  /** How much of the text the separator takes: 0 for `≈`, which stays in the target. */
  readonly length: number;
  /** Found in the source language's `[lang]` (then labels there may label the example). */
  readonly inLang: boolean;
}

function hasSeparator(atoms: readonly Atom[]): boolean {
  return findSeparator(atoms) !== undefined;
}

/**
 * Where the target starts: the first separator outside the source language, after the
 * first text in `[lang]` if there is one; failing that, a spaced `≈` in `[lang]`. `≈` stays
 * in the target; a dash does not.
 */
function findSeparator(atoms: readonly Atom[]): Separator | undefined {
  let start = atoms.findIndex((a) => a.inLang && !isBlank(a));
  const hasLang = start >= 0;
  if (start < 0) start = 0;
  for (let i = start; i < atoms.length; i++) {
    const atom = atoms[i] as Atom;
    if (atom.inLang || atom.label !== 0 || atom.kind !== 'text') continue;
    const match = SEPARATOR.exec(atom.text);
    if (match !== null) {
      const length = match[0] === '≈' ? 0 : match[0].length;
      return { atom: i, index: match.index, length, inLang: false };
    }
  }
  if (!hasLang) return undefined;
  for (let i = start; i < atoms.length; i++) {
    const atom = atoms[i] as Atom;
    if (!atom.inLang || atom.label !== 0 || atom.kind !== 'text') continue;
    const match = APPROXIMATE.exec(atom.text);
    if (match !== null) return { atom: i, index: match.index, length: 0, inLang: true };
  }
  return undefined;
}

/** Text in a source language, outside zones, with a dash: `phrase — translation`. */
function looksLikeExample(atoms: readonly Atom[]): boolean {
  const unzoned = atoms.filter((a) => a.kind === 'text' && a.role === 'text');
  if (unzoned.some((a) => a.inLang && !isBlank(a))) return true;
  return /\S\s+[—–]\s+\S/.test(text(unzoned));
}

function buildExample(atoms: readonly Atom[], context: ExtractionContext): Example | undefined {
  const separator = findSeparator(atoms);
  let source: Atom[] = [...atoms];
  let target: Atom[] = [];
  if (separator !== undefined) {
    const at = atoms[separator.atom] as Atom;
    source = [
      ...atoms.slice(0, separator.atom),
      { ...at, text: at.text.slice(0, separator.index) },
    ];
    target = [
      { ...at, text: at.text.slice(separator.index + separator.length) },
      ...atoms.slice(separator.atom + 1),
    ];
  }
  const labels: Label[] = [];
  const inLang = separator?.inLang ?? false;
  const sourceText = exampleText(source, labels, true, inLang, context);
  const targetText = exampleText(target, labels, false, inLang, context);
  const { header } = context.dictionary;
  const index = header.indexLanguageInfo?.name;
  const contents = header.contentsLanguageInfo?.name;
  const sourceLanguage = atoms.find((a) => a.inLang && a.language !== undefined)?.language ?? index;
  const targetLanguage =
    sourceLanguage !== undefined && sourceLanguage === contents ? index : contents;
  if (sourceText.length === 0 && targetText.length === 0) {
    return labels.length === 0 ? undefined : { source: { text: '' }, labels };
  }
  const example: { -readonly [K in keyof Example]: Example[K] } = {
    source: side(sourceText.length > 0 ? sourceText : targetText, sourceLanguage),
  };
  if (sourceText.length > 0 && targetText.length > 0) {
    example.target = side(targetText, targetLanguage);
  }
  if (labels.length > 0) example.labels = labels;
  return example;
}

function side(text: string, language: string | undefined): Example['source'] {
  return language === undefined ? { text } : { text, language };
}

/**
 * The text of one side of an example. Labels outside the source language (or anywhere, when
 * the whole example is in `[lang]`) are taken out where they label the example: at both ends
 * of the source, at the start of the target. Elsewhere they are part of the text.
 */
function exampleText(
  atoms: readonly Atom[],
  labels: Label[],
  isSource: boolean,
  inLang: boolean,
  context: ExtractionContext,
): string {
  const isLabel = (a: Atom): boolean =>
    a.role === 'example' && a.label !== 0 && (inLang || !a.inLang);
  const content = (a: Atom): boolean => !isLabel(a) && !isTrivial(a.text);
  const first = atoms.findIndex(content);
  const last = first < 0 ? -1 : isSource ? atoms.findLastIndex(content) : atoms.length - 1;
  const edges = first < 0 ? atoms : [...atoms.slice(0, first), ...atoms.slice(last + 1)];
  for (const group of labelGroups(edges.filter(isLabel))) {
    const found = label(group, context);
    if (found !== undefined) labels.push(found);
  }
  return first < 0 ? '' : collapse(text(atoms.slice(first, last + 1)));
}

/** Bracketed transcriptions among notes; the other notes are returned as they are. */
export function takeTranscriptions(notes: readonly string[], into: string[]): string[] {
  const rest: string[] = [];
  for (const note of notes) {
    const found = bracketedTranscriptions(note);
    if (found === undefined) rest.push(note);
    else into.push(...found.filter((t) => t.length > 0));
  }
  return rest;
}
