/**
 * Diagnostics: plain-data problem reports, sinks that receive them, and `DslError`.
 *
 * @packageDocumentation
 */

import { DIAGNOSTICS, type DiagnosticCode, type DiagnosticName, type Severity } from './catalog.js';

/**
 * A position in the decoded text.
 *
 * Offsets refer to the text after newline normalization (`\r\n` and `\r` become `\n`). Line
 * and column numbers are not affected by that normalization, so they also locate the position
 * in the original file.
 *
 * @experimental
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
 * @experimental
 */
export interface Diagnostic {
  /** Stable code from the catalog, e.g. `DSL1202`. */
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  /** Human-readable description (English). Do not match on it; use `code`. */
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

/**
 * Receives diagnostics as they are found.
 *
 * @experimental
 */
export interface DiagnosticSink {
  report(diagnostic: Diagnostic): void;
}

/** Fields of a diagnostic besides the code, severity and message. */
export type DiagnosticDetails = Pick<Diagnostic, 'position' | 'byteOffset' | 'cause'>;

/** Builds a diagnostic with the catalog's default severity. */
export function createDiagnostic(
  name: DiagnosticName,
  message: string,
  details: DiagnosticDetails = {},
): Diagnostic {
  const spec = DIAGNOSTICS[name];
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

/** Options of {@link DslError}. */
export interface DslErrorOptions {
  /** Underlying error. */
  readonly cause?: unknown;
  /** The diagnostic that caused the error (strict mode). */
  readonly diagnostic?: Diagnostic;
  /** Name of the plugin that failed (`DSL5xxx`). */
  readonly plugin?: string;
  /** Where in the source the error happened, e.g. the entry a plugin failed on. */
  readonly position?: SourcePosition;
}

/**
 * Error thrown by dsl-dicts: usage errors, unreadable input, and diagnostics of severity
 * `error` in strict mode. Runtime errors are never thrown as is: they are wrapped, with the
 * original error as `cause`.
 *
 * @experimental
 */
export class DslError extends Error {
  /** Stable code from the catalog. */
  readonly code: DiagnosticCode;
  /** The diagnostic behind this error, for strict-mode failures. */
  readonly diagnostic?: Diagnostic;
  /** Name of the plugin that failed, for plugin failures (`DSL5xxx`). */
  readonly plugin?: string;
  /** Where in the source the error happened, if known (the entry a plugin failed on). */
  readonly position?: SourcePosition;

  constructor(code: DiagnosticCode, message: string, options: DslErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DslError';
    this.code = code;
    if (options.diagnostic !== undefined) this.diagnostic = options.diagnostic;
    if (options.plugin !== undefined) this.plugin = options.plugin;
    if (options.position !== undefined) this.position = options.position;
  }

  /** Creates an error for a catalog entry by its symbolic name. */
  static of(name: DiagnosticName, message: string, cause?: unknown): DslError {
    return new DslError(DIAGNOSTICS[name].code, message, { cause });
  }

  /** Creates an error from a diagnostic, keeping its code, message and cause. */
  static fromDiagnostic(diagnostic: Diagnostic): DslError {
    return new DslError(diagnostic.code, diagnostic.message, {
      cause: diagnostic.cause,
      diagnostic,
    });
  }
}

/**
 * A sink that keeps every diagnostic.
 *
 * @experimental
 */
export interface CollectingSink extends DiagnosticSink {
  /** Diagnostics in the order they were reported. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Creates a sink that collects diagnostics into an array.
 *
 * @experimental
 */
export function createCollectingSink(): CollectingSink {
  const diagnostics: Diagnostic[] = [];
  return {
    diagnostics,
    report(diagnostic) {
      diagnostics.push(diagnostic);
    },
  };
}

/**
 * Creates a strict-mode sink: it forwards every diagnostic to `inner` (if any), then throws a
 * {@link DslError} for diagnostics of severity `error`.
 *
 * @experimental
 */
export function createStrictSink(inner?: DiagnosticSink): DiagnosticSink {
  return {
    report(diagnostic) {
      inner?.report(diagnostic);
      if (diagnostic.severity === 'error') throw DslError.fromDiagnostic(diagnostic);
    },
  };
}
