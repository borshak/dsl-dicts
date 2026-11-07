/**
 * Plain-text rendering of the markup AST: the shared helpers behind the `plain-text` and
 * `search-text` plugins, public for other plugins.
 *
 * @packageDocumentation
 */

import { DslError } from '../diagnostics/index.js';
import type { Headword, MarkupNode, TagNode } from '../markup/ast.js';
import { flipCase } from '../markup/tokenizer.js';

/**
 * Options of {@link toPlainText} and {@link zoneText}.
 *
 * @experimental
 */
export interface PlainTextOptions {
  /**
   * The entry's headwords, for `~`: it stands for the first index form of the first headword
   * (`headwords[0].variants[0]`, as in sub-entry headwords), `^~` for the same with the case
   * of its first character flipped. Without `headwords` or `tilde`, `~` is kept as `~`.
   */
  readonly headwords?: readonly Headword[];
  /** What `~` stands for; takes precedence over `headwords`. */
  readonly tilde?: string;
  /**
   * Indentation of a paragraph per `[m]` level: the paragraph of `[m2]` starts with it twice,
   * as do its continuation lines. Default `''` (no indentation).
   */
  readonly indent?: string;
  /** Include the secondary text of `[*]`. Default `true`. */
  readonly secondary?: boolean;
  /** Include the file names of `[s]` and `[video]`. Default `false`. */
  readonly media?: boolean;
  /**
   * Include text marked `[!trs]` (excluded from the search index, but displayed). Default
   * `true` in {@link toPlainText}; {@link zoneText} always leaves it out.
   */
  readonly unindexed?: boolean;
  /** Include `[p]` labels. Default `true` in {@link toPlainText}, `false` in {@link zoneText}. */
  readonly labels?: boolean;
  /**
   * Expansions of `[p]` labels, such as `DictionaryContext.abbreviations`: a label whose
   * text, normalized with {@link normalizeLabel}, is a key is replaced by its value. Labels
   * not in the map are kept as written. Keys must be normalized too, as those of
   * `parseAbbreviations` are.
   */
  readonly abbreviations?: ReadonlyMap<string, string>;
  /**
   * Include sub-entries: their headwords (`Headword.text`), one per line, then their content.
   * Default `true`.
   */
  readonly subentries?: boolean;
}

/**
 * Normalizes the text of a label, so that `[p]` labels and the headwords of `_abrv.dsl` can be
 * compared: every run of whitespace (Unicode `\s`, a non-breaking space included) becomes one
 * space, and leading and trailing whitespace is removed. Case is kept.
 *
 * This is the rule behind the keys of `parseAbbreviations` and the `abbreviations` lookup of
 * {@link toPlainText}.
 *
 * @example
 * ```ts
 * normalizeLabel('  adj.\u00a0 comp.\t'); // 'adj. comp.'
 * ```
 *
 * @throws DslError `DSL0001` if `text` is not a string.
 * @experimental
 */
export function normalizeLabel(text: string): string {
  if (typeof text !== 'string') throw DslError.of('invalidArgument', 'The label must be a string.');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The search zones of DSL, in the order of the manual: translations (`[trn]`, and `[trn1]`,
 * which the compiler generates), examples (`[ex]`) and comments (`[com]`).
 *
 * @experimental
 */
export const SEARCH_ZONES: readonly string[] = Object.freeze(['trn', 'trn1', 'ex', 'com']);

/** Resolved options. */
interface Settings {
  readonly tilde: string | undefined;
  readonly indent: string;
  readonly secondary: boolean;
  readonly media: boolean;
  readonly unindexed: boolean;
  readonly labels: boolean;
  readonly abbreviations: ReadonlyMap<string, string> | undefined;
  readonly subentries: boolean;
}

/**
 * Renders markup nodes as plain text, the way a DSL viewer displays it without styling.
 *
 * - Text as is; `~` and `^~` substituted (see `headwords`); tags are dropped and their
 *   content kept, except for the options below; links (`<<>>`, `[ref]`, `[url]`) give their
 *   text.
 * - Line breaks (between body lines, `[br]`) are newlines; an `[m]` paragraph starts on a
 *   new line, indented by `indent` per level.
 * - In each line, runs of spaces and tabs collapse to one space and the line is trimmed
 *   (U+00A0, an escaped space, is kept); empty lines are removed. The result has no leading
 *   or trailing newline.
 *
 * Pure: never mutates the nodes; works on deeply frozen trees.
 *
 * @throws DslError `DSL0001` for arguments of the wrong type.
 * @experimental
 */
export function toPlainText(nodes: readonly MarkupNode[], options: PlainTextOptions = {}): string {
  checkNodes(nodes);
  const writer = new Writer();
  render(nodes, writer, settings(options, true, true));
  return writer.finish();
}

/**
 * The text of the search zones in markup nodes: the content of every outermost tag named in
 * `zones` (by default {@link SEARCH_ZONES}), without `[!trs]` and media, and without `[p]`
 * labels unless `labels` is set (Lingvo leaves labels out of the index). Zones inside
 * `[!trs]` are left out too. Each zone gives one line, its text rendered like
 * {@link toPlainText} with all whitespace, line breaks included, collapsed to one space;
 * empty zones are left out.
 *
 * @returns The lines, joined with `\n`; empty if there are no zones or they are empty.
 * @throws DslError `DSL0001` for arguments of the wrong type.
 * @experimental
 */
export function zoneText(
  nodes: readonly MarkupNode[],
  zones: readonly string[] = SEARCH_ZONES,
  options: PlainTextOptions = {},
): string {
  checkNodes(nodes);
  if (!Array.isArray(zones)) throw DslError.of('invalidArgument', 'The zones must be an array.');
  const names = new Set(zones);
  const base = settings(options, false, false);
  const zone: Settings = { ...base, unindexed: false, indent: '' };
  const lines: string[] = [];
  const visit = (list: readonly MarkupNode[]): void => {
    for (const node of list) {
      if (node.type === 'tag') {
        if (names.has(node.name)) {
          const writer = new Writer();
          render(node.children, writer, zone);
          const text = writer.finish().replace(/\n/g, ' ');
          if (text.length > 0) lines.push(text);
        } else if (node.name !== '!trs' && !(isMedia(node) && !base.media)) {
          if (node.name !== '*' || base.secondary) visit(node.children);
        }
      } else if (node.type === 'subentry' && base.subentries) {
        visit(node.children);
      }
      // Links hold their target as text: there are no zones inside.
    }
  };
  visit(nodes);
  return lines.join('\n');
}

/**
 * Tells whether markup nodes contain a search zone: a tag named in `zones` (by default
 * {@link SEARCH_ZONES}), at any depth, sub-entries included.
 *
 * @experimental
 */
export function hasZones(
  nodes: readonly MarkupNode[],
  zones: readonly string[] = SEARCH_ZONES,
): boolean {
  checkNodes(nodes);
  const names = new Set(zones);
  const find = (list: readonly MarkupNode[]): boolean =>
    list.some(
      (node) =>
        (node.type === 'tag' && (names.has(node.name) || find(node.children))) ||
        (node.type === 'subentry' && find(node.children)),
    );
  return find(nodes);
}

function checkNodes(nodes: unknown): void {
  if (!Array.isArray(nodes)) {
    throw DslError.of('invalidArgument', 'The nodes must be an array of markup nodes.');
  }
}

function settings(options: PlainTextOptions, unindexed: boolean, labels: boolean): Settings {
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
  const { headwords, tilde, indent = '', abbreviations } = options;
  if (tilde !== undefined && typeof tilde !== 'string') {
    throw DslError.of('invalidArgument', 'The tilde option must be a string.');
  }
  if (headwords !== undefined && !Array.isArray(headwords)) {
    throw DslError.of('invalidArgument', 'The headwords option must be an array.');
  }
  if (typeof indent !== 'string') {
    throw DslError.of('invalidArgument', 'The indent option must be a string.');
  }
  if (abbreviations !== undefined && typeof abbreviations?.get !== 'function') {
    throw DslError.of('invalidArgument', 'The abbreviations option must be a Map.');
  }
  const first = headwords?.[0]?.variants?.[0];
  return {
    tilde: tilde ?? (typeof first === 'string' ? first : undefined),
    indent,
    secondary: options.secondary ?? true,
    media: options.media ?? false,
    unindexed: options.unindexed ?? unindexed,
    labels: options.labels ?? labels,
    abbreviations,
    subentries: options.subentries ?? true,
  };
}

function isMedia(node: TagNode): boolean {
  return node.name === 's' || node.name === 'video';
}

/** What `~` or `^~` becomes. */
function tildeText(tilde: string | undefined, flip: boolean): string {
  if (tilde === undefined) return flip ? '^~' : '~';
  if (!flip || tilde.length === 0) return tilde;
  const first = String.fromCodePoint(tilde.codePointAt(0) as number);
  return flipCase(first) + tilde.slice(first.length);
}

/** Collects lines with their indentation. */
class Writer {
  private readonly lines: string[] = [];
  private line = '';
  private lineIndent = '';
  /** Indentation of the paragraph being written. */
  indent = '';

  text(value: string): void {
    this.line += value;
  }

  /** A line break: the next line belongs to the same paragraph. */
  newline(): void {
    this.flush();
    this.lineIndent = this.indent;
  }

  /** Starts a paragraph on a new line, unless the current line is still blank. */
  paragraph(indent: string): void {
    if (!isBlank(this.line)) this.flush();
    this.indent = indent;
    this.lineIndent = indent;
  }

  finish(): string {
    this.flush();
    return this.lines.join('\n');
  }

  private flush(): void {
    const text = collapse(this.line);
    if (text.length > 0) this.lines.push(this.lineIndent + text);
    this.line = '';
  }
}

/** Collapses runs of spaces and tabs to one space and trims spaces and tabs. */
function collapse(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
}

function isBlank(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

function render(nodes: readonly MarkupNode[], out: Writer, s: Settings): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.text(node.text);
        break;
      case 'tilde':
        out.text(tildeText(s.tilde, node.flipCase));
        break;
      case 'lineBreak':
        out.newline();
        break;
      case 'link':
        render(node.children, out, s);
        break;
      case 'subentry':
        if (!s.subentries) break;
        out.paragraph(out.indent);
        for (const headword of node.headwords) {
          out.text(headword.text);
          out.newline();
        }
        render(node.children, out, s);
        out.paragraph(out.indent);
        break;
      case 'tag':
        renderTag(node, out, s);
        break;
    }
  }
}

function renderTag(node: TagNode, out: Writer, s: Settings): void {
  switch (node.name) {
    case 'm': {
      const outer = out.indent;
      out.paragraph(s.indent.repeat(node.attrs.level ?? 0));
      render(node.children, out, s);
      out.indent = outer;
      return;
    }
    case '*':
      if (s.secondary) render(node.children, out, s);
      return;
    case '!trs':
      if (s.unindexed) render(node.children, out, s);
      return;
    case 's':
    case 'video':
      if (s.media) render(node.children, out, s);
      return;
    case 'p': {
      if (!s.labels) return;
      const expansion = s.abbreviations?.get(normalizeLabel(labelText(node.children, s)));
      if (typeof expansion === 'string') out.text(expansion);
      else render(node.children, out, s);
      return;
    }
    default:
      render(node.children, out, s);
  }
}

/** The text of a label, for the abbreviation lookup. */
function labelText(nodes: readonly MarkupNode[], s: Settings): string {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text') text += node.text;
    else if (node.type === 'tilde') text += tildeText(s.tilde, node.flipCase);
    else if (node.type === 'lineBreak') text += ' ';
    else text += labelText(node.children, s);
  }
  return text;
}
