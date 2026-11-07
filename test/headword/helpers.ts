/**
 * Test helpers for the headword layer. Web-standard APIs only.
 */

import {
  createCollectingSink,
  type Diagnostic,
  type Headword,
  type ParseHeadwordOptions,
  parseHeadword,
} from '../../src/index.js';

export interface ParsedHeadword {
  readonly headword: Headword;
  readonly diagnostics: readonly Diagnostic[];
  readonly codes: readonly string[];
}

/** Parses a headword without positions, collecting diagnostics. */
export function hw(text: string, options: ParseHeadwordOptions = {}): ParsedHeadword {
  const sink = createCollectingSink();
  const headword = parseHeadword(text, { positions: false, ...options, diagnostics: sink });
  return { headword, diagnostics: sink.diagnostics, codes: sink.diagnostics.map((d) => d.code) };
}

/** The index forms of a headword. */
export function variants(text: string, options: ParseHeadwordOptions = {}): readonly string[] {
  return hw(text, options).headword.variants;
}
