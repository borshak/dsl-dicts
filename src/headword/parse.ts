/**
 * Headword parser: `{ }` unsortable parts, `( )` optional parts, escapes, `~`, and markup.
 *
 * One pass of the markup tokenizer in headword mode feeds two consumers: the tree builder,
 * which makes the `display` nodes, and a small scanner that collects the sortable text and the
 * optional groups, which are then expanded into the index forms.
 *
 * @packageDocumentation
 */

import {
  createDiagnostic,
  type DiagnosticName,
  type DiagnosticSink,
  DslError,
  type SourcePosition,
} from '../diagnostics/index.js';
import type { Headword, MarkupNode } from '../markup/ast.js';
import { TreeBuilder } from '../markup/builder.js';
import { orderedSink, reporter } from '../markup/report.js';
import { flipCase, isEscapedSpace, type Token, Tokenizer } from '../markup/tokenizer.js';
import { positionInLine, type RawEntry, type RawLine } from '../segment/index.js';

/**
 * Headwords with a longer sortable text are not expanded, as in GoldenDict (`DSL3202`).
 *
 * @experimental
 */
export const MAX_EXPANDED_LENGTH = 500;

/**
 * At most this many combinations of optional parts are generated (`DSL3203`).
 *
 * @experimental
 */
export const MAX_VARIANTS = 256;

/**
 * Options of {@link parseHeadword} and {@link parseHeadwords}.
 *
 * @experimental
 */
export interface HeadwordOptions {
  /**
   * Add `position` and `end` to the headword and its `display` nodes. Default `true`.
   * Diagnostics keep their positions either way.
   */
  readonly positions?: boolean;
  /**
   * Receives the diagnostics (codes `DSL3xxx`, and `DSL4xxx` for the markup), in source
   * order, once the headwords are parsed.
   */
  readonly diagnostics?: DiagnosticSink;
}

/**
 * Options of {@link parseHeadword}.
 *
 * @experimental
 */
export interface ParseHeadwordOptions extends HeadwordOptions {
  /**
   * What `~` stands for in `text` and `variants` (`^~` flips the case of its first
   * character), usually the first index form of the entry's first headword. Without it, a `~`
   * is kept as text (`DSL3102`).
   */
  readonly tilde?: string;
  /**
   * Source position of the first character of a string input. Default: offset 0, line 1,
   * column 1. Ignored for a `RawLine` input, which carries its own positions.
   */
  readonly origin?: SourcePosition;
}

/** How a headword is parsed. Internal. */
export interface HeadwordContext {
  readonly positions: boolean;
  /** A sink that sorts diagnostics before forwarding them, or `undefined`. */
  readonly diagnostics: DiagnosticSink | undefined;
  /** What `~` stands for, if known. */
  readonly tilde: string | undefined;
}

const ORIGIN: SourcePosition = { offset: 0, line: 1, column: 1 };

/**
 * Parses one headword: a line of an entry's headword block, or the text after the `@` of a
 * sub-entry. See {@link Headword} for the syntax and the meaning of the result. A string
 * input is one line; a newline in it is an ordinary character.
 *
 * Recovery, each with a diagnostic: an unclosed `{` makes the rest of the headword
 * unsortable (`DSL3001`); a stray `}` is ignored (`DSL3002`); an unclosed `(` ends at the end
 * of the headword (`DSL3003`); a stray `)` is shown but ignored in the index forms
 * (`DSL3004`); tags and links outside braces are parsed and their text is sortable
 * (`DSL3101`). Markup is parsed by the rules of `parseMarkup` (`DSL4xxx`).
 *
 * Never throws on any input, except a `DslError` for invalid arguments or from a strict
 * diagnostic sink.
 *
 * @param input - The headword, or a line from the segmenter (its positions are used).
 * @experimental
 */
export function parseHeadword(
  input: string | RawLine,
  options: ParseHeadwordOptions = {},
): Headword {
  checkOptions(options);
  let line: RawLine;
  if (typeof input === 'string') {
    line = { text: input, position: options.origin ?? ORIGIN };
  } else if (typeof input === 'object' && input !== null && typeof input.text === 'string') {
    line = input;
  } else {
    throw DslError.of('invalidArgument', 'The input must be a string or a RawLine.');
  }
  if (options.tilde !== undefined && typeof options.tilde !== 'string') {
    throw DslError.of('invalidArgument', 'The tilde option must be a string.');
  }
  const sink = orderedSink(options.diagnostics);
  const headword = buildHeadword(line, {
    positions: options.positions !== false,
    diagnostics: sink,
    tilde: options.tilde,
  });
  sink?.flush();
  return headword;
}

/**
 * Parses the headwords of an entry from the segmenter. A `~` in a headword after the first
 * stands for the first index form of the first headword, as in GoldenDict; in the first one
 * it stands for nothing (`DSL3102`).
 *
 * @returns One headword per line, in order.
 * @experimental
 */
export function parseHeadwords(
  entry: Pick<RawEntry, 'headwords'>,
  options: HeadwordOptions = {},
): Headword[] {
  checkOptions(options);
  if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.headwords)) {
    throw DslError.of('invalidArgument', 'The entry must have a headwords array.');
  }
  const sink = orderedSink(options.diagnostics);
  const positions = options.positions !== false;
  const result: Headword[] = [];
  let tilde: string | undefined;
  for (const line of entry.headwords) {
    const headword = buildHeadword(line, { positions, diagnostics: sink, tilde });
    if (result.length === 0) tilde = headword.variants[0];
    result.push(headword);
  }
  sink?.flush();
  return result;
}

/** What `~` stands for, given an entry's headwords: the first index form of the first one. */
export function tildeValue(headwords: readonly Headword[]): string | undefined {
  return headwords[0]?.variants[0];
}

function checkOptions(options: HeadwordOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
}

const SPACE = 0x20;
const TAB = 0x09;
const BACKSLASH = 0x5c;

/** A piece of the sortable text: text, or an optional group. */
type Piece = string | Group;

interface Group {
  readonly pieces: Piece[];
  /** Where the `(` is, for diagnostics. */
  readonly at: number;
}

/** Parses a headword line. Internal: the sink must sort diagnostics (see `orderedSink`). */
export function buildHeadword(line: RawLine, context: HeadwordContext): Headword {
  const text = line.text;
  const [from, to] = trimRange(text);
  const sink = context.diagnostics;
  const report = (name: DiagnosticName, message: string, at: number): void => {
    sink?.report(createDiagnostic(name, message, { position: positionInLine(line, at) }));
  };

  const tokens: Token[] = [];
  new Tokenizer(tokens, reporter([line], sink), true).line(text, 0, from, to);

  // The sortable text: everything outside braces, minus markup. Optional groups nest.
  const root: Group = { pieces: [], at: from };
  const groups: Group[] = [root];
  let flat = '';
  let depth = 0;
  let braceAt = -1;
  let markupReported = false;
  let tildeReported = false;
  let hasGroups = false;
  const display: Token[] = [];
  for (const t of tokens) {
    if (t.kind === 'punct' && (t.value === '{' || t.value === '}')) {
      if (t.value === '{') {
        if (depth++ === 0) braceAt = t.start;
      } else if (depth > 0) {
        depth--;
      } else {
        report('strayBrace', 'The } closes no {; it is ignored.', t.start);
      }
      continue;
    }
    display.push(t);
    switch (t.kind) {
      case 'text':
        if (depth === 0) {
          // An escaped space is a no-break space when shown, a plain space in index forms.
          const value = isEscapedSpace(t, text) ? ' ' : t.value;
          append(groups, value);
          flat += value;
        }
        break;
      case 'tilde': {
        if (context.tilde === undefined && !tildeReported) {
          tildeReported = true;
          report(
            'unresolvedTilde',
            'The ~ has no headword to stand for; it is kept as text.',
            t.start,
          );
        }
        if (depth === 0) {
          const value = resolveTilde(context.tilde, t.flip);
          append(groups, value);
          flat += value;
        }
        break;
      }
      case 'punct':
        if (depth > 0) break;
        if (t.value === '(') {
          const group: Group = { pieces: [], at: t.start };
          (groups[groups.length - 1] as Group).pieces.push(group);
          groups.push(group);
          hasGroups = true;
          flat += '(';
        } else if (groups.length > 1) {
          groups.pop();
          flat += ')';
        } else {
          report(
            'strayParenthesis',
            'The ) closes no (; it is ignored in the index forms.',
            t.start,
          );
          flat += ')';
        }
        break;
      case 'open':
      case 'close':
      case 'linkOpen':
        if (depth === 0 && !markupReported) {
          markupReported = true;
          report(
            'markupOutsideBraces',
            'The headword has markup outside braces, where Lingvo forbids it; its text is sortable.',
            t.start,
          );
        }
        break;
      default:
        break;
    }
  }
  if (depth > 0) {
    report(
      'unclosedBrace',
      'The { is not closed: the rest of the headword is unsortable.',
      braceAt,
    );
  }
  for (let i = groups.length - 1; i > 0; i--) {
    report(
      'unclosedParenthesis',
      'The ( is not closed: the optional part runs to the end of the headword.',
      (groups[i] as Group).at,
    );
  }

  // Index forms.
  let forms: string[];
  if (hasGroups && flat.length > MAX_EXPANDED_LENGTH) {
    report(
      'headwordTooLong',
      `The sortable text is longer than ${MAX_EXPANDED_LENGTH} characters: optional parts are not expanded.`,
      from,
    );
    forms = [flat];
  } else {
    if (count(root.pieces) > MAX_VARIANTS) {
      report(
        'tooManyVariants',
        `The headword has more than ${MAX_VARIANTS} combinations of optional parts; only the first ${MAX_VARIANTS} are kept.`,
        from,
      );
    }
    forms = expand(root.pieces, MAX_VARIANTS);
  }
  const variants = [...new Set(forms.map(normalizeSpace))].filter((form) => form.length > 0);
  if (variants.length === 0) {
    report('emptyHeadword', 'The headword has no sortable text, so no index form.', from);
  }

  const nodes = new TreeBuilder([line], display, {
    positions: context.positions,
    diagnostics: sink,
    headword: noHeadword,
  }).build();
  const headword: { -readonly [K in keyof Headword]: Headword[K] } = {
    raw: from === 0 && to === text.length ? text : text.slice(from, to),
    display: nodes,
    text: normalizeSpace(plainText(nodes, context.tilde)),
    variants,
  };
  if (context.positions) {
    headword.position = positionInLine(line, from);
    headword.end = positionInLine(line, to);
  }
  return headword;
}

/** The tree builder never meets sub-entries in a headword. */
function noHeadword(): Headword {
  throw new TypeError('Unexpected sub-entry in a headword.');
}

/** Appends text to the innermost open group. */
function append(groups: readonly Group[], value: string): void {
  const pieces = (groups[groups.length - 1] as Group).pieces;
  const last = pieces.length - 1;
  const previous = pieces[last];
  if (typeof previous === 'string') pieces[last] = previous + value;
  else pieces.push(value);
}

/** What a `~` or `^~` becomes in the plain text. */
function resolveTilde(tilde: string | undefined, flip: boolean): string {
  if (tilde === undefined) return flip ? '^~' : '~';
  if (!flip || tilde.length === 0) return tilde;
  const first = String.fromCodePoint(tilde.codePointAt(0) as number);
  return flipCase(first) + tilde.slice(first.length);
}

/** Number of combinations of a sequence of pieces, capped just above `MAX_VARIANTS`. */
function count(pieces: readonly Piece[]): number {
  let n = 1;
  for (const piece of pieces) {
    if (typeof piece !== 'string') n = Math.min(n * (1 + count(piece.pieces)), MAX_VARIANTS + 1);
  }
  return n;
}

/**
 * Every combination of the optional groups, at most `limit`: for each group, the forms
 * without it come before the forms with it, and the leftmost group varies slowest. Keeping
 * the first `limit` prefixes at each step keeps exactly the first `limit` combinations.
 */
function expand(pieces: readonly Piece[], limit: number): string[] {
  let forms = [''];
  for (const piece of pieces) {
    if (typeof piece === 'string') {
      forms = forms.map((form) => form + piece);
      continue;
    }
    const inner = expand(piece.pieces, limit);
    const next: string[] = [];
    outer: for (const prefix of forms) {
      next.push(prefix);
      if (next.length >= limit) break;
      for (const suffix of inner) {
        next.push(prefix + suffix);
        if (next.length >= limit) break outer;
      }
    }
    forms = next;
  }
  return forms;
}

/** Plain text of nodes: text, tildes substituted, line breaks as spaces. */
function plainText(nodes: readonly MarkupNode[], tilde: string | undefined): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.text;
        break;
      case 'tilde':
        out += resolveTilde(tilde, node.flipCase);
        break;
      case 'lineBreak':
        out += ' ';
        break;
      default:
        out += plainText(node.children, tilde);
    }
  }
  return out;
}

/** Collapses runs of spaces and tabs to one space and trims them. */
function normalizeSpace(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
}

/**
 * The range of a line without leading and trailing spaces and tabs; a trailing space escaped
 * with an odd number of backslashes is kept.
 */
function trimRange(text: string): [number, number] {
  let from = 0;
  let to = text.length;
  while (from < to && isSpace(text.charCodeAt(from))) from++;
  while (to > from && isSpace(text.charCodeAt(to - 1))) to--;
  if (to < text.length && to > from) {
    let slashes = 0;
    while (to - slashes - 1 >= from && text.charCodeAt(to - slashes - 1) === BACKSLASH) slashes++;
    if (slashes % 2 === 1) to++;
  }
  return [from, to];
}

function isSpace(code: number): boolean {
  return code === SPACE || code === TAB;
}
