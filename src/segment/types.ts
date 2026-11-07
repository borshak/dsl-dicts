/**
 * Data model of the segmentation layer: the header and raw entries.
 *
 * Everything here is plain, JSON-serializable data. Text is raw DSL markup with comments
 * removed; headwords and bodies are parsed by later layers.
 *
 * @packageDocumentation
 */

import type { SourcePosition } from '../diagnostics/index.js';

/**
 * A directive of the header, such as `#NAME "My dictionary"`.
 *
 * @experimental
 */
export interface Directive {
  /** Name as written, without `#`: `NAME`, `INDEX_LANGUAGE`, `ICON_FILE`. */
  readonly name: string;
  /** Everything after the name, without surrounding spaces and tabs: `"My dictionary"`. */
  readonly raw: string;
  /**
   * The value: the text between the first and the last double quote of `raw`, or `raw` itself
   * if it has fewer than two quotes (reported as `DSL2002`).
   */
  readonly value: string;
  /** Position of the `#`. */
  readonly position: SourcePosition;
}

/**
 * The header of a DSL file: the directives at its start.
 *
 * @experimental
 */
export interface DslHeader {
  /** Every directive of the header, in order, including unknown and repeated ones. */
  readonly directives: readonly Directive[];
  /** Value of the first `#NAME`, if any. */
  readonly name?: string;
  /** Value of the first `#INDEX_LANGUAGE` (the language of the headwords), if any. */
  readonly indexLanguage?: string;
  /** Value of the first `#CONTENTS_LANGUAGE` (the language of the bodies), if any. */
  readonly contentsLanguage?: string;
}

/**
 * Where a piece of a {@link RawLine}'s text starts in the source.
 *
 * @experimental
 */
export interface LineSegment {
  /** Index in the line's `text` where the piece starts. */
  readonly index: number;
  /** Source position of `text[index]`. */
  readonly position: SourcePosition;
}

/**
 * A line of an entry, with comments removed.
 *
 * Mapping a text index to the source: without `segments`, the text is contiguous in the source
 * and `text[i]` is at `position.offset + i` (and `position.column + i`, on `position.line`).
 * Removing a comment from the middle of a line, or a comment that spans lines, makes the text
 * non-contiguous; then `segments` lists where each contiguous piece starts, the first one at
 * index 0. See {@link positionInLine}.
 *
 * @experimental
 */
export interface RawLine {
  /** Text of the line, without the newline and without comments. */
  readonly text: string;
  /** Source position of `text[0]`. */
  readonly position: SourcePosition;
  /** Pieces of a non-contiguous text, in order; absent if the text is contiguous. */
  readonly segments?: readonly LineSegment[];
}

/**
 * Kind of a body line: ordinary text, or a sub-entry marker.
 *
 * @experimental
 */
export type BodyLineKind = 'text' | 'subentry-start' | 'subentry-end';

/** Fields shared by all body lines. */
interface BodyLineBase extends RawLine {
  readonly kind: BodyLineKind;
  /** The leading spaces and tabs that were removed from `text`. */
  readonly indent: string;
}

/**
 * An ordinary body line.
 *
 * @experimental
 */
export interface TextBodyLine extends BodyLineBase {
  readonly kind: 'text';
}

/**
 * A line that starts a sub-entry: `@ headword`. Several consecutive start lines give one
 * sub-entry several headwords.
 *
 * @experimental
 */
export interface SubentryStartLine extends BodyLineBase {
  readonly kind: 'subentry-start';
  /** Index of the `@` in `text`. Only tags and spaces may precede it. */
  readonly marker: number;
  /** Raw headword: the text after the `@`, without surrounding spaces and tabs. */
  readonly headword: string;
}

/**
 * A line that ends a sub-entry: a lone `@`, possibly followed by closing tags (`@[/m]`).
 *
 * @experimental
 */
export interface SubentryEndLine extends BodyLineBase {
  readonly kind: 'subentry-end';
  /** Index of the `@` in `text`. */
  readonly marker: number;
}

/**
 * A line of an entry's body. `text` has its indentation removed.
 *
 * @experimental
 */
export type BodyLine = TextBodyLine | SubentryStartLine | SubentryEndLine;

/**
 * An entry (card) with unparsed headwords and body. Every entry is a fresh object.
 *
 * Sub-entries stay in the body, marked by `subentry-start` and `subentry-end` lines, because
 * they live inside the markup structure of their parent entry.
 *
 * @experimental
 */
export interface RawEntry {
  /** Headword lines, at least one. */
  readonly headwords: readonly RawLine[];
  /** Body lines, in order; empty only for an entry at the end of the input without a body. */
  readonly body: readonly BodyLine[];
  /** Position of the first headword line. */
  readonly position: SourcePosition;
  /** Position just after the last character of the entry's last line (before its newline). */
  readonly end: SourcePosition;
}

/**
 * Maps an index in a line's text to its source position.
 *
 * @param index - Index into `line.text`, from 0 to `line.text.length` inclusive.
 * @experimental
 */
export function positionInLine(line: RawLine, index: number): SourcePosition {
  let base: LineSegment = { index: 0, position: line.position };
  if (line.segments !== undefined) {
    for (const segment of line.segments) {
      if (segment.index > index) break;
      base = segment;
    }
  }
  const delta = index - base.index;
  if (delta === 0) return base.position;
  const { offset, line: number, column } = base.position;
  return { offset: offset + delta, line: number, column: column + delta };
}
