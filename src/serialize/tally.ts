/**
 * Counting diagnostics for the summary of an export.
 *
 * @packageDocumentation
 */

import type { Diagnostic, DiagnosticSink, Severity } from '../diagnostics/index.js';

/**
 * A sink that only counts diagnostics, by code and by severity.
 *
 * @experimental
 */
export interface DiagnosticTally extends DiagnosticSink {
  /** The number of diagnostics reported. */
  readonly total: number;
  /** The counts by code, in code order. A new object on each read. */
  readonly byCode: Record<string, number>;
  /** The counts by severity. A new object on each read. */
  readonly bySeverity: Record<Severity, number>;
}

/**
 * Creates a {@link DiagnosticTally}. Pass it as the `diagnostics` sink of `parseDsl` (or
 * `openDsl`) to count the diagnostics of every layer, those of entries and plugins included,
 * and to `toJsonl` / `toJson` for their summary.
 *
 * @example
 * ```ts
 * const tally = createDiagnosticTally();
 * const dict = parseDsl(bytes, { diagnostics: tally });
 * for await (const line of toJsonl(dict, { plugin: article, summary: true, tally })) …
 * ```
 *
 * @experimental
 */
export function createDiagnosticTally(): DiagnosticTally {
  const codes = new Map<string, number>();
  const severities: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  let total = 0;
  return {
    get total() {
      return total;
    },
    get byCode() {
      return countsByCode(codes);
    },
    get bySeverity() {
      return { ...severities };
    },
    report(diagnostic: Diagnostic) {
      total++;
      codes.set(diagnostic.code, (codes.get(diagnostic.code) ?? 0) + 1);
      severities[diagnostic.severity]++;
    },
  };
}

/** The counts of a map as an object with the keys in code order. */
export function countsByCode(counts: ReadonlyMap<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const code of [...counts.keys()].sort()) result[code] = counts.get(code) as number;
  return result;
}
