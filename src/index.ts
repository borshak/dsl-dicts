/**
 * Core entry point of dsl-dicts.
 *
 * Everything reachable from here is runtime-neutral: no Node.js APIs.
 *
 * @packageDocumentation
 */

/** Current package version. Keep in sync with `package.json`. */
export const VERSION = '2.0.0-beta.0';

export {
  type DecodedText,
  type DecodeInfo,
  type DecodeOptions,
  type DecompressMode,
  type DslSource,
  decodeDsl,
  type EncodingDecision,
  type EncodingSource,
} from './decode/index.js';
export {
  type CollectingSink,
  createCollectingSink,
  createStrictSink,
  DIAGNOSTICS,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticName,
  type DiagnosticSink,
  type DiagnosticSpec,
  DslError,
  type DslErrorOptions,
  findDiagnosticSpec,
  type Severity,
  type SourcePosition,
} from './diagnostics/index.js';
