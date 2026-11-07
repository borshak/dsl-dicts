/**
 * Diagnostic plumbing shared by the markup and headword parsers. Internal.
 *
 * @packageDocumentation
 */

import { createDiagnostic, type Diagnostic, type DiagnosticSink } from '../diagnostics/index.js';
import { positionInLine, type RawLine } from '../segment/index.js';
import type { TokenReporter } from './tokenizer.js';

/** A sink that holds diagnostics back until `flush`. */
export interface OrderedSink extends DiagnosticSink {
  flush(): void;
}

/**
 * Buffers diagnostics and forwards them in source order: the tokenizer runs over all lines
 * before the tree builder, and some problems are only known at the end (unclosed tags).
 */
export function orderedSink(target: DiagnosticSink | undefined): OrderedSink | undefined {
  if (target === undefined) return undefined;
  const buffer: Diagnostic[] = [];
  return {
    report(diagnostic) {
      buffer.push(diagnostic);
    },
    flush() {
      // Stable sort: diagnostics at the same offset keep the order they were reported in.
      buffer.sort((a, b) => (a.position?.offset ?? 0) - (b.position?.offset ?? 0));
      for (const diagnostic of buffer) target.report(diagnostic);
      buffer.length = 0;
    },
  };
}

/** Reports tokenizer problems to a sink, with positions from the lines. */
export function reporter(
  lines: readonly RawLine[],
  sink: DiagnosticSink | undefined,
): TokenReporter {
  if (sink === undefined) return () => {};
  return (name, message, line, at) => {
    const position = positionInLine(lines[line] as RawLine, at);
    sink.report(createDiagnostic(name, message, { position }));
  };
}
