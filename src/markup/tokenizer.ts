/**
 * Markup tokenizer: one line of DSL markup in, a flat list of tokens out.
 *
 * Internal: the token list is not part of the public API, but the headword parser reuses it.
 *
 * @packageDocumentation
 */

import type { DiagnosticName } from '../diagnostics/index.js';
import type { RawLine } from '../segment/index.js';

/**
 * Token kinds. The tokenizer produces the first seven; `parseBody` adds the line and
 * sub-entry structure.
 */
export type TokenKind =
  /** Literal text; `value` has escapes resolved. Never empty. */
  | 'text'
  /** `[name attrs]`: `value` is the name as written, `attrs` the raw attribute text. */
  | 'open'
  /** `[/name attrs]`. */
  | 'close'
  /** `<<`; a matching `linkClose` always follows on the same line. */
  | 'linkOpen'
  /** `>>`. */
  | 'linkClose'
  /** `~`, or `^~` with `flip`. */
  | 'tilde'
  /** Headword mode only: one of `{ } ( )`, in `value`. */
  | 'punct'
  /** A line boundary: the next tokens are on line `line`. */
  | 'newline'
  /** Starts a sub-entry with the headword `headword`; `start` is the `@`. */
  | 'subentryOpen'
  /** Adds the headword `headword` to the open sub-entry. */
  | 'subentryHeadword'
  /** Ends the open sub-entry; `start` is the `@`, or the start of the line after it. */
  | 'subentryClose';

/** A token. All fields are always set, so that every token has the same shape. */
export interface Token {
  readonly kind: TokenKind;
  /** Index of the token's line in the line list. */
  readonly line: number;
  /** Index of the token's first character in the line's text. */
  readonly start: number;
  /** Index just after the token's last character. */
  readonly end: number;
  readonly value: string;
  readonly attrs: string;
  readonly flip: boolean;
  readonly headword: RawLine | undefined;
}

/** Creates a token. */
export function token(
  kind: TokenKind,
  line: number,
  start: number,
  end: number,
  value = '',
  attrs = '',
  flip = false,
  headword: RawLine | undefined = undefined,
): Token {
  return { kind, line, start, end, value, attrs, flip, headword };
}

/** Reports a tokenizer problem at an index of the current line. */
export type TokenReporter = (
  name: DiagnosticName,
  message: string,
  line: number,
  at: number,
) => void;

const BACKSLASH = 0x5c;
const CARET = 0x5e;
const TILDE = 0x7e;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const LESS = 0x3c;
const GREATER = 0x3e;
const SLASH = 0x2f;
const SPACE = 0x20;
const TAB = 0x09;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** States of the text scanner. Tags and links are scanned by sub-machines. */
const S_TEXT = 0;
/** After `\`: the next character is literal. */
const S_ESCAPE = 1;
/** After `^`: the next character has its case flipped. */
const S_CARET = 2;
type State = typeof S_TEXT | typeof S_ESCAPE | typeof S_CARET;

/** Flips the case of a character: lowercase to uppercase and the other way round. */
export function flipCase(ch: string): string {
  const lower = ch.toLowerCase();
  return lower === ch ? ch.toUpperCase() : lower;
}

/** Length of the character at `i`: 2 for a surrogate pair, else 1. */
function charLength(text: string, i: number, to: number): number {
  const c = text.charCodeAt(i);
  if (c < 0xd800 || c > 0xdbff || i + 1 >= to) return 1;
  const d = text.charCodeAt(i + 1);
  return d >= 0xdc00 && d <= 0xdfff ? 2 : 1;
}

/**
 * Character-level tokenizer, a finite-state machine with one character of lookahead.
 *
 * Rules (DSL manual, with GoldenDict's behavior where the manual is silent):
 * - `\x` is the literal `x` for any character `x`, metacharacter or not: `\\` is a backslash,
 *   `\a` is `a`. An escaped space is a no-break space (U+00A0), except inside `[s]` and
 *   `[video]`, where file names keep plain spaces. A `\` at the end of a line is kept
 *   (`DSL4003`).
 * - `[[` and `]]` are literal brackets; a lone `]` is literal too.
 * - `[name attrs]` and `[/name attrs]` are tags. The name starts right after `[` or `[/` and
 *   ends at a space, a tab or `]`; the tag ends at the first unescaped `]`. A tag never spans
 *   lines. A `[` without `]` on its line, or followed by another `[` first, is literal
 *   (`DSL4001`); `[]`, `[/]`, `[ b]` and names with a backslash are literal (`DSL4002`).
 *   Names are not validated here.
 * - `<<target>>` is a link; it ends at the first unescaped `>>` on its line and cannot nest.
 *   Without `>>` the `<<` is literal (`DSL4005`); `<<>>` is literal (`DSL4006`). A lone `<`
 *   or `>` is literal.
 * - `~` is the headword; `^~` the headword with its first character's case flipped.
 * - `^x` is `x` with its case flipped, if `x` is a letter that has case (manual; GoldenDict
 *   only knows `^~` and shows any other `^`). Before anything else (a tag, a link, a space, a
 *   digit, punctuation, another `^`, the end of the line) the flip would do nothing, so the
 *   `^` is literal (`DSL4004`): real dictionaries contain such literal carets.
 * - In headword mode, `{ } ( )` are `punct` tokens and `^` is literal, except in `^~`
 *   (GoldenDict expands `^~` in headwords; Lingvo knows no other `^` there).
 *
 * The tokenizer keeps the `[s]`/`[video]` nesting count across lines, so use one instance
 * per text.
 */
export class Tokenizer {
  /** Open `[s]` and `[video]` tags, for escaped spaces. */
  private media = 0;
  // State of the text token under construction.
  private text = '';
  private lineIndex = 0;
  /** Unescaped text before `mark`. */
  private acc = '';
  /** Start of the raw text not yet copied to `acc`. */
  private mark = 0;
  /** Start of the pending text token, or -1. */
  private textStart = -1;

  constructor(
    private readonly out: Token[],
    private readonly report: TokenReporter,
    private readonly headword = false,
  ) {}

  /** Tokenizes `text[from..to)`, the line with index `lineIndex`. */
  line(text: string, lineIndex: number, from = 0, to = text.length): void {
    this.text = text;
    this.lineIndex = lineIndex;
    this.scan(from, to, false);
  }

  private scan(from: number, to: number, inLink: boolean): void {
    const text = this.text;
    this.acc = '';
    this.mark = from;
    this.textStart = -1;
    let state: State = S_TEXT;
    let flip = false;
    let caretAt = -1;
    let i = from;
    while (i < to) {
      const c = text.charCodeAt(i);
      switch (state) {
        case S_TEXT:
          switch (c) {
            case BACKSLASH:
              this.cut(i);
              state = S_ESCAPE;
              i++;
              break;
            case CARET:
              if (this.headword) {
                // Only `^~` is special in a headword; any other `^` is literal.
                if (i + 1 < to && text.charCodeAt(i + 1) === TILDE) {
                  this.emitText(i);
                  this.out.push(token('tilde', this.lineIndex, i, i + 2, '', '', true));
                  this.mark = i + 2;
                  i += 2;
                } else {
                  this.literal(i);
                  i++;
                }
              } else {
                caretAt = i;
                state = S_CARET;
                i++;
              }
              break;
            case TILDE:
              this.emitText(i);
              this.out.push(token('tilde', this.lineIndex, i, i + 1));
              this.mark = i + 1;
              i++;
              break;
            case OPEN_BRACKET:
              if (i + 1 < to && text.charCodeAt(i + 1) === OPEN_BRACKET) {
                this.cut(i);
                this.acc += '[';
                this.mark = i + 2;
                i += 2;
              } else {
                i = this.tag(i, to);
              }
              break;
            case CLOSE_BRACKET:
              if (i + 1 < to && text.charCodeAt(i + 1) === CLOSE_BRACKET) {
                this.cut(i);
                this.acc += ']';
                this.mark = i + 2;
                i += 2;
              } else {
                this.literal(i);
                i++;
              }
              break;
            case LESS:
              if (!inLink && i + 1 < to && text.charCodeAt(i + 1) === LESS) {
                i = this.link(i, to);
              } else {
                this.literal(i);
                i++;
              }
              break;
            case OPEN_BRACE:
            case CLOSE_BRACE:
            case OPEN_PAREN:
            case CLOSE_PAREN:
              if (this.headword) {
                this.emitText(i);
                this.out.push(token('punct', this.lineIndex, i, i + 1, text[i]));
                this.mark = i + 1;
              } else {
                this.literal(i);
              }
              i++;
              break;
            default:
              this.literal(i);
              i++;
          }
          break;

        case S_ESCAPE: {
          // `i` is the escaped character; `mark` is at the backslash.
          const n = charLength(text, i, to);
          let ch = c === SPACE && this.media === 0 ? NO_BREAK_SPACE : text.slice(i, i + n);
          if (flip) {
            const flipped = flipCase(ch);
            if (flipped === ch) {
              // Nothing to flip: the `^` is literal.
              this.strayCaret(caretAt);
              ch = `^${ch}`;
            } else {
              ch = flipped;
            }
          }
          this.acc += ch;
          this.mark = i + n;
          i += n;
          flip = false;
          state = S_TEXT;
          break;
        }

        case S_CARET:
          // `i` is the character after the `^` at `caretAt`; `mark` is at or before the `^`.
          if (c === TILDE) {
            this.emitText(caretAt);
            this.out.push(token('tilde', this.lineIndex, caretAt, i + 1, '', '', true));
            this.mark = i + 1;
            i++;
            state = S_TEXT;
          } else if (c === BACKSLASH) {
            this.cut(caretAt);
            flip = true;
            state = S_ESCAPE;
            i++;
          } else {
            const n = charLength(text, i, to);
            const ch = text.slice(i, i + n);
            const flipped = flipCase(ch);
            if (flipped === ch) {
              // Nothing to flip (a tag, a link, a space, a digit...): keep the `^` as text and
              // process the character normally.
              this.strayCaret(caretAt);
            } else {
              this.cut(caretAt);
              this.acc += flipped;
              this.mark = i + n;
              i += n;
            }
            state = S_TEXT;
          }
          break;
      }
    }
    if (state === S_ESCAPE) {
      // The backslash at `mark` stays in the text.
      this.report(
        'danglingEscape',
        'A backslash at the end of the line escapes nothing.',
        this.lineIndex,
        this.mark,
      );
    } else if (state === S_CARET) {
      this.strayCaret(caretAt);
    }
    this.emitText(to);
  }

  /** Keeps a `^` as text. */
  private strayCaret(at: number): void {
    if (this.textStart < 0) this.textStart = at;
    this.report(
      'strayCaret',
      'The ^ is not followed by a letter or ~ whose case it could flip; it is kept as text.',
      this.lineIndex,
      at,
    );
  }

  /** The raw character at `i` is part of the text. */
  private literal(i: number): void {
    if (this.textStart < 0) this.textStart = i;
  }

  /** Copies the raw text before `i` to `acc`, so that `text[i]` can be replaced. */
  private cut(i: number): void {
    if (this.textStart < 0) this.textStart = i;
    if (i > this.mark) this.acc += this.text.slice(this.mark, i);
    this.mark = i;
  }

  /** Emits the pending text token, which ends at `end`. */
  private emitText(end: number): void {
    if (this.textStart >= 0) {
      const value = end > this.mark ? this.acc + this.text.slice(this.mark, end) : this.acc;
      if (value.length > 0) {
        this.out.push(token('text', this.lineIndex, this.textStart, end, value));
      }
    }
    this.acc = '';
    this.textStart = -1;
    this.mark = end;
  }

  /**
   * Scans a tag starting with the `[` at `i`. Emits it, or keeps the `[` as text.
   *
   * @returns The index to go on from.
   */
  private tag(i: number, to: number): number {
    const text = this.text;
    let j = i + 1;
    const closing = j < to && text.charCodeAt(j) === SLASH;
    if (closing) j++;
    const nameStart = j;
    let c = -1;
    while (j < to) {
      c = text.charCodeAt(j);
      if (
        c === CLOSE_BRACKET ||
        c === SPACE ||
        c === TAB ||
        c === OPEN_BRACKET ||
        c === BACKSLASH
      ) {
        break;
      }
      j++;
    }
    if (j >= to || c === OPEN_BRACKET) return this.badTag(i, 'unterminatedTag');
    if (j === nameStart || c === BACKSLASH) return this.badTag(i, 'malformedTag');
    const name = text.slice(nameStart, j);
    let attrs = '';
    let end = j + 1;
    if (c !== CLOSE_BRACKET) {
      // Attributes: up to the first unescaped `]`.
      let k = j;
      for (;;) {
        if (k >= to) return this.badTag(i, 'unterminatedTag');
        const d = text.charCodeAt(k);
        if (d === CLOSE_BRACKET) break;
        if (d === OPEN_BRACKET) return this.badTag(i, 'unterminatedTag');
        k += d === BACKSLASH ? 2 : 1;
      }
      attrs = trimSpaces(text, j, k);
      end = k + 1;
    }
    this.emitText(i);
    this.out.push(token(closing ? 'close' : 'open', this.lineIndex, i, end, name, attrs));
    this.mark = end;
    if (name === 's' || name === 'video') {
      if (!closing) this.media++;
      else if (this.media > 0) this.media--;
    }
    return end;
  }

  private badTag(i: number, name: 'unterminatedTag' | 'malformedTag'): number {
    this.literal(i);
    this.report(
      name,
      name === 'unterminatedTag'
        ? 'The [ has no closing ] on its line; it is kept as text.'
        : 'The tag has no name or is malformed; it is kept as text.',
      this.lineIndex,
      i,
    );
    return i + 1;
  }

  /**
   * Scans a link starting with the `<<` at `i`. Emits it, or keeps the `<<` as text.
   *
   * @returns The index to go on from.
   */
  private link(i: number, to: number): number {
    const text = this.text;
    let k = i + 2;
    while (k + 1 < to) {
      const c = text.charCodeAt(k);
      if (c === BACKSLASH) {
        k += 2;
      } else if (c === GREATER && text.charCodeAt(k + 1) === GREATER) {
        break;
      } else {
        k++;
      }
    }
    if (k + 1 >= to) {
      this.literal(i);
      this.report('unclosedLink', 'The << has no closing >> on its line.', this.lineIndex, i);
      return i + 2;
    }
    if (k === i + 2) {
      this.literal(i);
      this.report('emptyLink', 'The <<>> link has no target.', this.lineIndex, i);
      return k + 2;
    }
    this.emitText(i);
    this.out.push(token('linkOpen', this.lineIndex, i, i + 2));
    this.scan(i + 2, k, true);
    this.out.push(token('linkClose', this.lineIndex, k, k + 2));
    this.acc = '';
    this.textStart = -1;
    this.mark = k + 2;
    return k + 2;
  }
}

/** `text[from..to)` without leading and trailing spaces and tabs. */
function trimSpaces(text: string, from: number, to: number): string {
  let a = from;
  let b = to;
  while (a < b && (text.charCodeAt(a) === SPACE || text.charCodeAt(a) === TAB)) a++;
  while (b > a && (text.charCodeAt(b - 1) === SPACE || text.charCodeAt(b - 1) === TAB)) b--;
  return text.slice(a, b);
}
