/**
 * Catalog of diagnostic codes: the single source of truth for codes, default severities and
 * one-line summaries. Documentation is generated from this table.
 *
 * Code ranges, one per layer:
 * - `DSL0xxx`: general API usage.
 * - `DSL1xxx`: input, decompression and encoding detection.
 * - `DSL2xxx`: line segmentation (header, cards, sub-entries, comments).
 * - `DSL3xxx`: headwords.
 * - `DSL4xxx`: body markup.
 *
 * Codes are stable: once released, a code keeps its meaning and is never reused.
 *
 * @packageDocumentation
 */

/** Severity of a diagnostic. */
export type Severity = 'error' | 'warning' | 'info';

/** Catalog entry of one diagnostic code. */
export interface DiagnosticSpec {
  /** Stable code, `DSL` followed by four digits. */
  readonly code: string;
  /** Severity used when the code is reported. */
  readonly severity: Severity;
  /** One-line description of the problem. */
  readonly summary: string;
  /**
   * The code is never reported to a diagnostic sink: it is only thrown as a `DslError`
   * (usage errors, unreadable input, missing runtime features).
   */
  readonly thrown?: true;
}

/**
 * All diagnostic codes, keyed by a symbolic name used in the source code.
 *
 * @experimental
 */
export const DIAGNOSTICS = {
  invalidArgument: {
    code: 'DSL0001',
    severity: 'error',
    summary: 'An argument or option has an invalid type or value.',
    thrown: true,
  },
  alreadyConsumed: {
    code: 'DSL0002',
    severity: 'error',
    summary: 'A single-use result was iterated more than once.',
    thrown: true,
  },
  cancelled: {
    code: 'DSL0003',
    severity: 'error',
    summary: 'Processing was cancelled before the requested result was available.',
    thrown: true,
  },

  readFailed: {
    code: 'DSL1001',
    severity: 'error',
    summary: 'Reading the input source failed; the original error is the cause.',
    thrown: true,
  },
  unknownEncoding: {
    code: 'DSL1002',
    severity: 'error',
    summary: 'The encoding option is neither a Lingvo code page name nor a known encoding label.',
    thrown: true,
  },
  unsupportedEncoding: {
    code: 'DSL1003',
    severity: 'error',
    summary: 'The encoding is known but this runtime cannot decode it.',
    thrown: true,
  },
  decompressionUnavailable: {
    code: 'DSL1004',
    severity: 'error',
    summary: 'The input is gzip-compressed but this runtime has no DecompressionStream.',
    thrown: true,
  },
  decompressionFailed: {
    code: 'DSL1101',
    severity: 'error',
    summary:
      'The gzip data is invalid, truncated, has trailing data or several members; decoding stops.',
  },
  bomMismatch: {
    code: 'DSL1201',
    severity: 'warning',
    summary: 'The byte order mark contradicts the forced encoding and is decoded as text.',
  },
  unknownCodePage: {
    code: 'DSL1202',
    severity: 'warning',
    summary: 'The #SOURCE_CODE_PAGE value is not recognized; the default encoding is used.',
  },
  unusableCodePage: {
    code: 'DSL1203',
    severity: 'warning',
    summary:
      'The #SOURCE_CODE_PAGE encoding is unsupported by this runtime or not ASCII-compatible; ' +
      'the default encoding is used.',
  },
  codePageIgnored: {
    code: 'DSL1204',
    severity: 'info',
    summary: 'The #SOURCE_CODE_PAGE directive is ignored because a BOM or UTF-16 was detected.',
  },
  codePageOverridden: {
    code: 'DSL1205',
    severity: 'warning',
    summary: 'The #SOURCE_CODE_PAGE directive is ignored because the content is valid UTF-8.',
  },
  replacementCharacter: {
    code: 'DSL1206',
    severity: 'warning',
    summary:
      'The decoded text contains U+FFFD: the input is probably malformed for the chosen ' +
      'encoding. Reported once per input.',
  },
} as const satisfies Record<string, DiagnosticSpec>;

/** Symbolic name of a diagnostic, e.g. `unknownCodePage`. */
export type DiagnosticName = keyof typeof DIAGNOSTICS;

/** Stable diagnostic code, e.g. `DSL1202`. */
export type DiagnosticCode = (typeof DIAGNOSTICS)[DiagnosticName]['code'];

const BY_CODE: ReadonlyMap<string, DiagnosticSpec> = new Map(
  Object.values(DIAGNOSTICS).map((spec) => [spec.code, spec]),
);

/**
 * Finds the catalog entry of a code.
 *
 * @returns The entry, or `undefined` if the code is not in the catalog.
 * @experimental
 */
export function findDiagnosticSpec(code: string): DiagnosticSpec | undefined {
  return BY_CODE.get(code);
}
