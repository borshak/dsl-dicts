/**
 * Diagnostics: plain-data problem reports, sinks that receive them, and `DslError`.
 *
 * @packageDocumentation
 */

import { CATALOG, type DiagnosticCode, type DiagnosticName, type Severity } from './catalog.js';

/**
 * A position in the decoded text. Part of the AST contract: the positions of entries,
 * headwords, nodes and diagnostics all have this shape, for both `position` and `end`.
 *
 * Offsets refer to the text after newline normalization (`\r\n` and `\r` become `\n`). Line
 * and column numbers are not affected by that normalization, so they also locate the position
 * in the original file.
 */
export interface SourcePosition {
  /** Zero-based offset in UTF-16 code units into the normalized text. */
  readonly offset: number;
  /** One-based line number. */
  readonly line: number;
  /** One-based column, in UTF-16 code units. */
  readonly column: number;
}

/**
 * A problem found in the input. Plain data: everything except `cause` is JSON-serializable.
 *
 * The `code`, `severity` and `position` are stable; the `message` is not: its wording may
 * change in any version, so match on the code.
 */
export interface Diagnostic {
  /**
   * The code: from the catalog (`DSL1202`, see `DIAGNOSTICS`), or a code of a plugin, by
   * convention `<plugin-name>/<id>`. Unknown codes are to be expected: the catalog grows in
   * minor versions.
   */
  readonly code: DiagnosticCode | (string & {});
  /**
   * How serious the problem is: the catalog's default severity of the code, or the one a
   * plugin chose. Strict mode (the `strict` option) turns diagnostics of a severity into
   * errors.
   */
  readonly severity: Severity;
  /** Human-readable description (English). Not stable: do not match on it; use `code`. */
  readonly message: string;
  /** Where the problem is in the decoded text, if known. */
  readonly position?: SourcePosition;
  /**
   * Zero-based offset into the input bytes (after decompression), for problems found before
   * or during decoding. Absent for string input.
   */
  readonly byteOffset?: number;
  /**
   * Who reported the problem, for diagnostics that do not come from the parser itself: the
   * name of the plugin, as set by `createPluginDiagnostic`. Absent for the parser's own
   * diagnostics.
   */
  readonly source?: string;
  /** Underlying runtime error, if any. Not serializable; for debugging only. */
  readonly cause?: unknown;
}

/** Receives diagnostics as they are found. */
export interface DiagnosticSink {
  /**
   * Called once per diagnostic, synchronously, in the order the diagnostics are found. A
   * sink may throw to stop processing (as a strict sink does); the error then reaches the
   * caller of the operation that found the diagnostic.
   */
  report(diagnostic: Diagnostic): void;
}

/** Fields of a diagnostic besides the code, severity and message. */
export type DiagnosticDetails = Pick<Diagnostic, 'position' | 'byteOffset' | 'cause'>;

/** Builds a diagnostic with the catalog's default severity. Internal. */
export function createDiagnostic(
  name: DiagnosticName,
  message: string,
  details: DiagnosticDetails = {},
): Diagnostic {
  const spec = CATALOG[name];
  const diagnostic: { -readonly [K in keyof Diagnostic]: Diagnostic[K] } = {
    code: spec.code,
    severity: spec.severity,
    message,
  };
  if (details.position !== undefined) diagnostic.position = details.position;
  if (details.byteOffset !== undefined) diagnostic.byteOffset = details.byteOffset;
  if (details.cause !== undefined) diagnostic.cause = details.cause;
  return diagnostic;
}

/** Options of the {@link DslError} constructor. */
export interface DslErrorOptions {
  /** Underlying error. */
  readonly cause?: unknown;
  /** The diagnostic that caused the error (strict mode). */
  readonly diagnostic?: Diagnostic;
  /** Name of the plugin that failed (`DSL5xxx`), or whose options are invalid (`DSL0001`). */
  readonly plugin?: string;
  /** Where in the source the error happened, e.g. the entry a plugin failed on. */
  readonly position?: SourcePosition;
}

/**
 * Error thrown by dsl-dicts: usage errors, unreadable input, and diagnostics in strict mode.
 * Runtime errors are never thrown as is: they are wrapped, with the original error as
 * `cause`.
 */
export class DslError extends Error {
  /**
   * The code: from the catalog (see `DIAGNOSTICS`), or the code of a diagnostic of a plugin
   * that strict mode turned into an error.
   */
  readonly code: DiagnosticCode | (string & {});
  /** The diagnostic behind this error, for strict-mode failures. */
  declare readonly diagnostic?: Diagnostic;
  /**
   * Name of the plugin that failed (`DSL5001`, `DSL5002`) or refused its options
   * (`DSL0001`).
   */
  declare readonly plugin?: string;
  /** Where in the source the error happened, if known (the entry a plugin failed on). */
  declare readonly position?: SourcePosition;

  /**
   * Creates an error. Plugins throw `new DslError('DSL0001', message)` for invalid options.
   *
   * @param code - A code of the catalog, or any other code (such as a plugin's).
   * @param message - What went wrong (English).
   * @param options - The cause, and what the error is about.
   */
  constructor(
    code: DiagnosticCode | (string & {}),
    message: string,
    options: DslErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DslError';
    this.code = code;
    if (options.diagnostic !== undefined) this.diagnostic = options.diagnostic;
    if (options.plugin !== undefined) this.plugin = options.plugin;
    if (options.position !== undefined) this.position = options.position;
  }
}

/** Creates an error for a catalog entry by its symbolic name. Internal. */
export function dslError(name: DiagnosticName, message: string, cause?: unknown): DslError {
  return new DslError(CATALOG[name].code, message, { cause });
}

/** Creates an error from a diagnostic, keeping its code, message and cause. Internal. */
export function errorOfDiagnostic(diagnostic: Diagnostic): DslError {
  return new DslError(diagnostic.code, diagnostic.message, {
    cause: diagnostic.cause,
    diagnostic,
  });
}

/** A sink that keeps every diagnostic. */
export interface CollectingSink extends DiagnosticSink {
  /** Diagnostics in the order they were reported. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Creates a sink that collects diagnostics into an array. */
export function createCollectingSink(): CollectingSink {
  const diagnostics: Diagnostic[] = [];
  return {
    diagnostics,
    report(diagnostic) {
      diagnostics.push(diagnostic);
    },
  };
}

/** Rank of a severity: the more severe, the higher. */
const RANK: Readonly<Record<Severity, number>> = { info: 0, warning: 1, error: 2 };

/**
 * Creates a strict-mode sink: it forwards every diagnostic to `inner` (if any), then throws a
 * {@link DslError} for diagnostics of severity `severity` or more severe.
 *
 * @param inner - The sink that receives every diagnostic first.
 * @param severity - The least severe severity that fails: `error` (the default) fails on
 * errors, `warning` on warnings and errors, `info` on any diagnostic.
 * @throws DslError `DSL0001` if `severity` is not a severity.
 */
export function createStrictSink(
  inner?: DiagnosticSink,
  severity: Severity = 'error',
): DiagnosticSink {
  if (!(severity in RANK)) {
    throw dslError('invalidArgument', 'The severity must be "error", "warning" or "info".');
  }
  const threshold = RANK[severity];
  return {
    report(diagnostic) {
      inner?.report(diagnostic);
      if ((RANK[diagnostic.severity] ?? RANK.error) >= threshold) {
        throw errorOfDiagnostic(diagnostic);
      }
    },
  };
}

/**
 * The severity at which the `strict` option fails, or `undefined` when it is off.
 *
 * @throws DslError `DSL0001` for a value that is neither a boolean nor a severity.
 */
export function strictSeverity(strict: unknown): Severity | undefined {
  if (strict === undefined || strict === false) return undefined;
  if (strict === true) return 'error';
  if (typeof strict === 'string' && strict in RANK) return strict as Severity;
  throw dslError(
    'invalidArgument',
    'The strict option must be a boolean or a severity: "error", "warning" or "info".',
  );
}

/**
 * The sink of an operation's options: `diagnostics`, behind a strict sink when `strict` asks
 * for one.
 */
export function optionsSink(options: {
  readonly diagnostics?: DiagnosticSink | undefined;
  readonly strict?: boolean | Severity | undefined;
}): DiagnosticSink | undefined {
  const severity = strictSeverity(options.strict);
  return severity === undefined
    ? options.diagnostics
    : createStrictSink(options.diagnostics, severity);
}

/**
 * How many diagnostics were reported: in total, by code and by severity. Exact, whatever the
 * `diagnosticsLimit`.
 */
export interface DiagnosticCounts {
  /** The number of diagnostics. */
  readonly total: number;
  /** The counts by code, the codes in ascending order. */
  readonly byCode: Readonly<Record<string, number>>;
  /** The counts by severity, each severity present (0 if none). */
  readonly bySeverity: Readonly<Record<Severity, number>>;
}

/** Default of the `diagnosticsLimit` option. */
export const DEFAULT_DIAGNOSTICS_LIMIT = 10_000;

/**
 * Checks the `diagnosticsLimit` option.
 *
 * @throws DslError `DSL0001` for a value that is not a non-negative integer.
 */
export function diagnosticsLimitOf(limit: unknown): number {
  if (limit === undefined) return DEFAULT_DIAGNOSTICS_LIMIT;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    throw dslError('invalidArgument', 'The diagnosticsLimit option must be an integer >= 0.');
  }
  return limit;
}

/**
 * Keeps the first diagnostics, up to a limit, and counts all of them. Internal: the store
 * behind `diagnostics` and `diagnosticCounts()` of the results of `decodeDsl`, `segmentDsl`
 * and `parseDsl`.
 */
export class DiagnosticLog {
  /** The diagnostics kept, in order. Never replaced, so that it can be handed out. */
  readonly kept: Diagnostic[] = [];
  readonly #limit: number;
  readonly #codes = new Map<string, number>();
  readonly #severities: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  #total = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  record(diagnostic: Diagnostic): void {
    this.#total++;
    this.#codes.set(diagnostic.code, (this.#codes.get(diagnostic.code) ?? 0) + 1);
    if (diagnostic.severity in this.#severities) this.#severities[diagnostic.severity]++;
    if (this.kept.length < this.#limit) this.kept.push(diagnostic);
  }

  counts(): DiagnosticCounts {
    const byCode: Record<string, number> = {};
    for (const code of [...this.#codes.keys()].sort())
      byCode[code] = this.#codes.get(code) as number;
    return { total: this.#total, byCode, bySeverity: { ...this.#severities } };
  }
}
