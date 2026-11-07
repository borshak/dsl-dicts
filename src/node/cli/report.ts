/**
 * Reporting diagnostics to standard error.
 *
 * @packageDocumentation
 */

import type { Writable } from 'node:stream';
import type { Diagnostic, DiagnosticCounts, DiagnosticSink } from '../../index.js';
import type { Verbosity } from './options.js';

/** A sink that prints diagnostics as they are reported, when verbose. */
export interface Reporter extends DiagnosticSink {
  /**
   * Prints the summary line of the file, from the counts of the dictionary: unless quiet or
   * verbose, or there is nothing to report.
   */
  finish(counts: DiagnosticCounts | undefined): void;
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
  return {
    report(diagnostic) {
      if (verbosity === 'verbose') stderr.write(`${formatDiagnostic(file, diagnostic)}\n`);
    },
    finish(counts) {
      if (verbosity !== 'summary' || counts === undefined || counts.total === 0) return;
      const noun = counts.total === 1 ? 'diagnostic' : 'diagnostics';
      stderr.write(
        `${file}: ${counts.total} ${noun} (${formatCounts(counts.byCode)}); use --verbose to list them\n`,
      );
    },
  };
}
