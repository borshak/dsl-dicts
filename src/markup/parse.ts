/**
 * `parseMarkup` and `parseBody`: the public entry points of the markup layer.
 *
 * @packageDocumentation
 */

import {
  createDiagnostic,
  type Diagnostic,
  type DiagnosticSink,
  DslError,
  type SourcePosition,
} from '../diagnostics/index.js';
import {
  type BodyLine,
  type LineSegment,
  positionInLine,
  type RawEntry,
  type RawLine,
} from '../segment/index.js';
import type { MarkupNode } from './ast.js';
import { TreeBuilder } from './builder.js';
import { type Token, Tokenizer, type TokenReporter, token } from './tokenizer.js';

/**
 * Options of {@link parseMarkup} and {@link parseBody}.
 *
 * @experimental
 */
export interface MarkupOptions {
  /**
   * Add `position` and `end` to every node. Default `true`. Switch it off to save memory and
   * time when positions are not needed; diagnostics keep their positions either way.
   */
  readonly positions?: boolean;
  /**
   * Receives the diagnostics (codes `DSL4xxx`), in source order, once the text is parsed.
   * A strict sink made with `createStrictSink` throws out of the parse call.
   */
  readonly diagnostics?: DiagnosticSink;
}

/**
 * Options of {@link parseMarkup}.
 *
 * @experimental
 */
export interface ParseMarkupOptions extends MarkupOptions {
  /**
   * Source position of the first character of a string input, for node and diagnostic
   * positions. Default: offset 0, line 1, column 1. Ignored for a `RawLine` input, which
   * carries its own positions.
   */
  readonly origin?: SourcePosition;
}

const ORIGIN: SourcePosition = { offset: 0, line: 1, column: 1 };

/**
 * Parses a string of DSL markup, such as one body line or the part of a headword in braces,
 * into nodes.
 *
 * A `\n` in the string separates lines, as between body lines: tags may span lines and a
 * `lineBreak` node separates the lines' content. Sub-entry markers (`@`) are not recognized
 * here, and comments (`{{ }}`) must already be removed: both are the segmenter's job. The
 * text should be newline-normalized (no `\r`), as produced by `decodeDsl`.
 *
 * See `parseBody` for the rules. Never throws on any input, except a `DslError` for invalid
 * arguments or from a strict diagnostic sink.
 *
 * @param input - The markup, or a line from the segmenter (its positions are used).
 * @experimental
 */
export function parseMarkup(
  input: string | RawLine,
  options: ParseMarkupOptions = {},
): MarkupNode[] {
  checkOptions(options);
  let lines: readonly RawLine[];
  if (typeof input === 'string') {
    lines = splitLines(input, options.origin ?? ORIGIN);
  } else if (typeof input === 'object' && input !== null && typeof input.text === 'string') {
    lines = [input];
  } else {
    throw DslError.of('invalidArgument', 'The input must be a string or a RawLine.');
  }
  return parseLines(lines, options);
}

/**
 * Parses the body of an entry into nodes. Lazy by design: call it on the entries you need,
 * in any order; it only reads the entry, so the result does not depend on how the input was
 * chunked or on other entries.
 *
 * Body lines are separated by `lineBreak` nodes (see `LineBreakNode` for where there are
 * none). Tags may span lines. A sub-entry (`@ headword` lines, then body lines, then a lone
 * `@`) becomes a `subentry` node at the current position: inside the tags open at that point.
 * Tags opened inside a sub-entry are closed at its end, and tags of the parent cannot be
 * closed from inside it. On a marker line, tags before the `@` belong to the content before
 * the marker; closing tags after a lone `@` (`@[/m]`) apply after the sub-entry is closed.
 * A sub-entry that is not closed (`DSL2301`) ends at the next sub-entry or at the end of the
 * body.
 *
 * Tokenizer rules are those of the internal `Tokenizer`; tree recovery rules those of the
 * internal `TreeBuilder` (both documented in the source and in the diagnostic catalog). In
 * short:
 * - escapes `\x` make any character literal; `[[`, `]]` are brackets; `\ ` is U+00A0
 *   (a plain space in `[s]` and `[video]`);
 * - `~` and `^~` become `tilde` nodes; `^x` flips the case of a letter `x`, any other `^` is
 *   literal;
 * - `[m]` tags are block-level, need no closing tag, and close the previous one;
 * - crossed tags are closed and reopened; stray closing tags are ignored; unclosed tags are
 *   closed at the end; text-only tags (`[t]`, `[s]`, `[ref]`, ...) and `<<>>` links keep
 *   their content as text; unknown tags are kept as tags only if they are closed;
 * - malformed markup is kept as text. Every recovery is reported.
 *
 * @experimental
 */
export function parseBody(
  entry: Pick<RawEntry, 'body'>,
  options: MarkupOptions = {},
): MarkupNode[] {
  checkOptions(options);
  if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.body)) {
    throw DslError.of('invalidArgument', 'The entry must have a body array.');
  }
  const lines = entry.body;
  const sink = orderedSink(options.diagnostics);
  const tokens: Token[] = [];
  const tokenizer = new Tokenizer(tokens, reporter(lines, sink));
  let open = false;
  let linesInSubentry = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as BodyLine;
    if (i > 0) tokens.push(token('newline', i, 0, 0));
    switch (line.kind) {
      case 'text':
        tokenizer.line(line.text, i);
        if (open) linesInSubentry++;
        break;
      case 'subentry-start': {
        const sameSubentry = open && linesInSubentry === 0;
        if (open && !sameSubentry) tokens.push(token('subentryClose', i, 0, 0));
        markerSide(tokenizer, tokens, line, i, 0, line.marker);
        tokens.push(
          token(
            sameSubentry ? 'subentryHeadword' : 'subentryOpen',
            i,
            line.marker,
            line.marker + 1,
            '',
            '',
            false,
            headwordLine(line),
          ),
        );
        open = true;
        linesInSubentry = 0;
        break;
      }
      case 'subentry-end':
        markerSide(tokenizer, tokens, line, i, 0, line.marker);
        if (open) tokens.push(token('subentryClose', i, line.marker, line.marker + 1));
        open = false;
        markerSide(tokenizer, tokens, line, i, line.marker + 1, line.text.length);
        break;
    }
  }
  return build(lines, tokens, options, sink);
}

/**
 * Parses lines of markup. Internal; the headword parser uses it with `headword` set, which
 * makes `{ } ( )` tokens and `^` literal.
 */
export function parseLines(
  lines: readonly RawLine[],
  options: MarkupOptions,
  headword = false,
): MarkupNode[] {
  const sink = orderedSink(options.diagnostics);
  const tokens: Token[] = [];
  const tokenizer = new Tokenizer(tokens, reporter(lines, sink), headword);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) tokens.push(token('newline', i, 0, 0));
    tokenizer.line((lines[i] as RawLine).text, i);
  }
  return build(lines, tokens, options, sink);
}

function build(
  lines: readonly RawLine[],
  tokens: readonly Token[],
  options: MarkupOptions,
  sink: OrderedSink | undefined,
): MarkupNode[] {
  const nodes = new TreeBuilder(lines, tokens, {
    positions: options.positions !== false,
    diagnostics: sink,
  }).build();
  sink?.flush();
  return nodes;
}

function checkOptions(options: MarkupOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
}

/** Tokenizes the tags around a sub-entry marker; spaces there are layout, not content. */
function markerSide(
  tokenizer: Tokenizer,
  tokens: Token[],
  line: BodyLine,
  index: number,
  from: number,
  to: number,
): void {
  if (from >= to) return;
  const first = tokens.length;
  tokenizer.line(line.text, index, from, to);
  let kept = first;
  for (let i = first; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind === 'text' && /^[ \t]*$/.test(t.value)) continue;
    tokens[kept++] = t;
  }
  tokens.length = kept;
}

/** The headword of a sub-entry start line, as a line of its own with its positions. */
function headwordLine(line: BodyLine & { readonly headword: string }): RawLine {
  let start = (line as { marker: number }).marker + 1;
  while (line.text[start] === ' ' || line.text[start] === '\t') start++;
  const position = positionInLine(line, start);
  const segments: LineSegment[] = [{ index: 0, position }];
  for (const segment of line.segments ?? []) {
    const index = segment.index - start;
    if (index > 0 && index < line.headword.length)
      segments.push({ index, position: segment.position });
  }
  return segments.length > 1
    ? { text: line.headword, position, segments }
    : { text: line.headword, position };
}

/** Splits a string at `\n` into lines with positions. */
function splitLines(text: string, origin: SourcePosition): RawLine[] {
  const lines: RawLine[] = [];
  let start = 0;
  let line = origin.line;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    lines.push({
      text: start === 0 && end === text.length ? text : text.slice(start, end),
      position: {
        offset: origin.offset + start,
        line,
        column: start === 0 ? origin.column : 1,
      },
    });
    if (nl === -1) return lines;
    start = nl + 1;
    line++;
  }
}

interface OrderedSink extends DiagnosticSink {
  flush(): void;
}

/**
 * Buffers diagnostics and forwards them in source order: the tokenizer runs over all lines
 * before the tree builder, and some problems are only known at the end (unclosed tags).
 */
function orderedSink(target: DiagnosticSink | undefined): OrderedSink | undefined {
  if (target === undefined) return undefined;
  const buffer: Diagnostic[] = [];
  return {
    report(diagnostic) {
      buffer.push(diagnostic);
    },
    flush() {
      buffer.sort((a, b) => (a.position?.offset ?? 0) - (b.position?.offset ?? 0));
      for (const diagnostic of buffer) target.report(diagnostic);
    },
  };
}

function reporter(lines: readonly RawLine[], sink: DiagnosticSink | undefined): TokenReporter {
  if (sink === undefined) return () => {};
  return (name, message, line, at) => {
    const position = positionInLine(lines[line] as RawLine, at);
    sink.report(createDiagnostic(name, message, { position }));
  };
}
