/**
 * Line reader: splits text chunks into lines and removes `{{ … }}` comments.
 *
 * This is the only place where comments are handled. Later layers never see them.
 *
 * @packageDocumentation
 */

import { NewlineNormalizer } from '../decode/text-output.js';
import { createDiagnostic, type Diagnostic, type SourcePosition } from '../diagnostics/index.js';
import type { LineSegment } from './types.js';

/** A logical line: one source line, or several joined by a comment that spans lines. */
export interface LogicalLine {
  readonly text: string;
  /** Position of `text[0]`; for an empty text, of the start of the first source line. */
  readonly position: SourcePosition;
  /** Pieces of a non-contiguous text (more than one); see `RawLine.segments`. */
  readonly segments: LineSegment[] | undefined;
  /** A comment was removed from the line. */
  readonly comment: boolean;
  /** Position just after the last character of the last source line (before its newline). */
  readonly end: SourcePosition;
}

const BACKSLASH = 0x5c;

/** Pieces of a logical line under construction. */
interface Builder {
  readonly parts: string[];
  readonly segments: LineSegment[];
  length: number;
  readonly start: SourcePosition;
}

/**
 * Splits newline-normalized text into logical lines, correctly for any chunking.
 *
 * Comment rules (from the Lingvo manual; GoldenDict agrees except for escaping):
 * - `{{` starts a comment and the next `}}` ends it, also on a later line. Nothing is special
 *   inside a comment, not even `\`: `{{a\}}` is a complete comment.
 * - Outside comments `\` escapes the next character, so `\{{` is a literal `{` followed by `{`.
 * - A comment that spans lines joins the text before it and the text after it into one logical
 *   line, as in GoldenDict. The lines in between, headwords included, are swallowed.
 * - A comment that is not closed at the end of input swallows the rest (`DSL2101`).
 *
 * The reader also normalizes `\r\n` and `\r` to `\n` (a no-op for text from `decodeDsl`) and
 * optionally removes a leading BOM, so positions are those of `decodeDsl`'s text.
 */
export class LineReader {
  private readonly newlines = new NewlineNormalizer();
  private started = false;
  /** Pieces of the current, incomplete source line. */
  private carry: string[] = [];
  /** Offset and number of the current source line. */
  private offset = 0;
  private line = 1;
  private inComment = false;
  private commentStart: SourcePosition | undefined;
  /** Logical line under construction while a comment spans lines. */
  private builder: Builder | undefined;
  /** End of the last source line swallowed by an open comment. */
  private commentEnd: SourcePosition | undefined;

  /**
   * @param stripBom - Remove a leading BOM. Off for text from `decodeDsl`, which has already
   *   removed one: a second U+FEFF is text there.
   */
  constructor(
    private readonly onLine: (line: LogicalLine) => void,
    private readonly report: (diagnostic: Diagnostic) => void,
    private readonly stripBom: boolean,
  ) {}

  push(chunk: string): void {
    let text = this.newlines.push(chunk);
    if (!this.started && text.length > 0) {
      this.started = true;
      if (this.stripBom && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    let start = 0;
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
      let line = text.slice(start, nl);
      if (this.carry.length > 0) {
        this.carry.push(line);
        line = this.carry.join('');
        this.carry = [];
      }
      this.sourceLine(line);
      this.offset += line.length + 1;
      this.line++;
      start = nl + 1;
    }
    if (start < text.length) this.carry.push(start === 0 ? text : text.slice(start));
  }

  /** Ends the input: flushes the last line, which may lack a newline. */
  end(): void {
    if (this.carry.length > 0) {
      const line = this.carry.join('');
      this.carry = [];
      this.sourceLine(line);
      this.offset += line.length;
    }
    if (this.inComment) {
      this.inComment = false;
      this.report(
        createDiagnostic('unclosedComment', 'The comment is not closed before the end of input.', {
          position: this.commentStart,
        }),
      );
      const builder = this.builder as Builder;
      this.builder = undefined;
      this.emit(builder, this.commentEnd as SourcePosition);
    }
  }

  private position(column0: number): SourcePosition {
    return { offset: this.offset + column0, line: this.line, column: column0 + 1 };
  }

  private sourceLine(text: string): void {
    // Fast path: no comment is open and none starts on this line.
    if (!this.inComment && text.indexOf('{{') === -1) {
      this.onLine({
        text,
        position: this.position(0),
        segments: undefined,
        comment: false,
        end: this.position(text.length),
      });
      return;
    }
    let builder = this.builder;
    if (builder === undefined) {
      builder = { parts: [], segments: [], length: 0, start: this.position(0) };
    }
    let i = 0;
    let keptFrom = 0;
    while (i < text.length) {
      if (this.inComment) {
        const close = text.indexOf('}}', i);
        if (close === -1) break;
        this.inComment = false;
        i = close + 2;
        keptFrom = i;
        continue;
      }
      const open = findCommentStart(text, i);
      if (open === -1) {
        this.keep(builder, text, keptFrom, text.length);
        i = text.length;
        break;
      }
      this.keep(builder, text, keptFrom, open);
      this.inComment = true;
      this.commentStart = this.position(open);
      i = open + 2;
    }
    if (this.inComment) {
      this.builder = builder;
      this.commentEnd = this.position(text.length);
      return;
    }
    this.builder = undefined;
    this.emit(builder, this.position(text.length));
  }

  private keep(builder: Builder, text: string, from: number, to: number): void {
    if (to <= from) return;
    builder.parts.push(from === 0 && to === text.length ? text : text.slice(from, to));
    builder.segments.push({ index: builder.length, position: this.position(from) });
    builder.length += to - from;
  }

  private emit(builder: Builder, end: SourcePosition): void {
    const { parts, segments } = builder;
    this.onLine({
      text: parts.length === 1 ? (parts[0] as string) : parts.join(''),
      position: segments[0]?.position ?? builder.start,
      segments: segments.length > 1 ? segments : undefined,
      comment: true,
      end,
    });
  }
}

/** Index of the first unescaped `{{` in `text` from `from` on, or -1. */
function findCommentStart(text: string, from: number): number {
  for (let at = text.indexOf('{{', from); at !== -1; at = text.indexOf('{{', at + 1)) {
    // An odd run of backslashes right before the brace escapes it.
    let backslashes = 0;
    while (at - backslashes - 1 >= from && text.charCodeAt(at - backslashes - 1) === BACKSLASH) {
      backslashes++;
    }
    if (backslashes % 2 === 0) return at;
  }
  return -1;
}
