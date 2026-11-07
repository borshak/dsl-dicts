/**
 * Reporting diagnostics to standard error.
 *
 * @packageDocumentation
 */

import type { Writable } from 'node:stream';
import {
  createDiagnosticTally,
  type Diagnostic,
  type DiagnosticSink,
  type DiagnosticTally,
} from '../../index.js';

/** How much of the diagnostics is printed. */
export type Verbosity = 'quiet' | 'summary' | 'verbose';

/** A tally that also prints diagnostics as they are reported, when verbose. */
export interface Reporter extends DiagnosticSink {
  readonly tally: DiagnosticTally;
  /** Prints the summary line of the file, unless quiet or verbose or there is nothing. */
  finish(): void;
}

/** One diagnostic as a line: `file:line:column: severity CODE message`. */
export function formatDiagnostic(file: string, diagnostic: Diagnostic): string {
  const { position } = diagnostic;
  const where = position === undefined ? '' : `:${position.line}:${position.column}`;
  return `${file}${where}: ${diagnostic.severity} ${diagnostic.code} ${diagnostic.message}`;
}

/** `DSL2001 x3, DSL4101 x9`. */
export function formatCounts(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .map(([code, count]) => `${code} x${count}`)
    .join(', ');
}

/** Creates the reporter of the diagnostics of one file. */
export function createReporter(file: string, stderr: Writable, verbosity: Verbosity): Reporter {
  const tally = createDiagnosticTally();
  return {
    tally,
    report(diagnostic) {
      tally.report(diagnostic);
      if (verbosity === 'verbose') stderr.write(`${formatDiagnostic(file, diagnostic)}\n`);
    },
    finish() {
      if (verbosity !== 'summary' || tally.total === 0) return;
      const noun = tally.total === 1 ? 'diagnostic' : 'diagnostics';
      stderr.write(
        `${file}: ${tally.total} ${noun} (${formatCounts(tally.byCode)}); use --verbose to list them\n`,
      );
    },
  };
}
