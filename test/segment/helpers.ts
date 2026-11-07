/**
 * Test helpers for the segmentation layer. Web-standard APIs only.
 */

import {
  type BodyLine,
  createCollectingSink,
  createSegmenter,
  type Diagnostic,
  type DslHeader,
  positionInLine,
  type RawEntry,
  type RawLine,
  type SegmentOptions,
  type SourcePosition,
  segmentDsl,
} from '../../src/index.js';

export const HEADER = '#NAME "Test"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "Russian"\n';

export interface Segmented {
  readonly header: DslHeader | undefined;
  readonly entries: readonly RawEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly codes: readonly string[];
}

/** Splits text into chunks of the given sizes (cycled). */
export function splitText(text: string, sizes: number | readonly number[]): string[] {
  const list = typeof sizes === 'number' ? [sizes] : sizes;
  const chunks: string[] = [];
  for (let offset = 0, i = 0; offset < text.length; i++) {
    const size = Math.max(1, list[i % list.length] as number);
    chunks.push(text.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

/** Runs the synchronous segmenter over text split into chunks. */
export function segment(text: string, sizes: number | readonly number[] = 65536): Segmented {
  const sink = createCollectingSink();
  const segmenter = createSegmenter({ diagnostics: sink });
  const entries: RawEntry[] = [];
  for (const chunk of splitText(text, sizes)) entries.push(...segmenter.push(chunk));
  entries.push(...segmenter.end());
  return {
    header: segmenter.header,
    entries,
    diagnostics: sink.diagnostics,
    codes: sink.diagnostics.map((d) => d.code),
  };
}

/** Runs `segmentDsl` to the end. */
export async function segmentAsync(
  source: Parameters<typeof segmentDsl>[0],
  options?: SegmentOptions,
): Promise<Segmented> {
  const result = segmentDsl(source, options);
  const entries: RawEntry[] = [];
  for await (const entry of result.entries()) entries.push(entry);
  const header = await result.header;
  const diagnostics = result.diagnostics;
  return { header, entries, diagnostics, codes: diagnostics.map((d) => d.code) };
}

/** Headword texts of each entry. */
export function headwords(entries: readonly RawEntry[]): string[][] {
  return entries.map((e) => e.headwords.map((h) => h.text));
}

/** Compact view of a body: `kind:text`, or just the text for text lines. */
export function bodies(entries: readonly RawEntry[]): string[][] {
  return entries.map((e) => e.body.map(describe));
}

function describe(line: BodyLine): string {
  if (line.kind === 'subentry-start') return `start:${line.headword}`;
  if (line.kind === 'subentry-end') return `end:${line.text}`;
  return line.text;
}

/** Every line of the entries: headwords, then body lines. */
export function allLines(entries: readonly RawEntry[]): RawLine[] {
  return entries.flatMap((e) => [...e.headwords, ...e.body]);
}

/** Computes the position of an offset in normalized text, independently of the code under test. */
export function positionOf(text: string, offset: number): SourcePosition {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { offset, line: before.split('\n').length, column: offset - lineStart + 1 };
}

/**
 * Checks that every character of every line maps back to the same character in the source,
 * with consistent line and column numbers. Returns a description of the first mismatch.
 */
export function checkPositions(source: string, entries: readonly RawEntry[]): string | undefined {
  for (const line of allLines(entries)) {
    for (let i = 0; i < line.text.length; i++) {
      const position = positionInLine(line, i);
      if (source[position.offset] !== line.text[i]) {
        return `${JSON.stringify(line.text)}[${i}] maps to offset ${position.offset}`;
      }
      const expected = positionOf(source, position.offset);
      if (expected.line !== position.line || expected.column !== position.column) {
        return `${JSON.stringify(line.text)}[${i}]: ${JSON.stringify(position)}`;
      }
    }
  }
  for (const entry of entries) {
    const expected = positionOf(source, entry.end.offset);
    if (expected.line !== entry.end.line || expected.column !== entry.end.column) {
      return `entry end ${JSON.stringify(entry.end)}`;
    }
  }
  return undefined;
}
