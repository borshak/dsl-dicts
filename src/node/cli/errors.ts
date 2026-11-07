/**
 * Exit codes of the CLI, and the errors that carry them.
 *
 * @packageDocumentation
 */

import { isAbsolute, relative } from 'node:path';
import { DslError } from '../../index.js';

/** Process exit codes of `dsl-dicts`. Stable: scripts may rely on them. */
export const EXIT = {
  /** Success. */
  ok: 0,
  /**
   * Usage error: unknown command or option, a missing or invalid argument, options that a
   * plugin refuses.
   */
  usage: 1,
  /** Dictionary or I/O error: unreadable input, a strict-mode failure, output that cannot be written. */
  dictionary: 2,
  /** Plugin error: the plugin cannot be loaded, or fails while setting up or processing. */
  plugin: 3,
  /** Internal error: a bug of dsl-dicts (`EX_SOFTWARE`). */
  internal: 70,
} as const;

/** An error with the exit code it ends the CLI with. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** A usage error (exit code 1). */
export const usageError = (message: string): CliError => new CliError(EXIT.usage, message);

/**
 * The exit code an error ends the CLI with: that of a `CliError`, by code for a `DslError`,
 * `dictionary` for an error of the system (it has a string `code`, such as `ENOENT`), and
 * `internal` for anything else, which can only be a bug.
 */
export function exitCodeOf(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof DslError) {
    switch (error.code) {
      // A plugin that fails, or whose output is no JSON.
      case 'DSL5001':
      case 'DSL5002':
      case 'DSL7006':
        return EXIT.plugin;
      // An option the library or a plugin refuses: the encoding, mostly.
      case 'DSL0001':
      case 'DSL1002':
      case 'DSL1003':
        return EXIT.usage;
      default:
        return EXIT.dictionary;
    }
  }
  if (isSystemError(error)) return EXIT.dictionary;
  return EXIT.internal;
}

/** An error of the system or of Node.js, such as `ENOENT` or `ERR_STREAM_PREMATURE_CLOSE`. */
function isSystemError(error: unknown): boolean {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

/** Whether an error is a closed output pipe (`dsl-dicts … | head`). */
export function isBrokenPipe(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

/**
 * The message of an error, with its code for a `DslError`; for an internal error, its stack,
 * to be reported.
 */
export function describeError(error: unknown): string {
  if (exitCodeOf(error) === EXIT.internal) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return `internal error, please report it: ${detail}`;
  }
  if (error instanceof DslError) {
    const position = error.position ?? error.diagnostic?.position;
    const where =
      position === undefined ? '' : ` (line ${position.line}, column ${position.column})`;
    return `${error.code}: ${error.message}${where}`;
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

/** A path for messages: relative to the working directory when it is inside it. */
export function displayPath(cwd: string, path: string): string {
  const shorter = relative(cwd, path);
  return shorter.length > 0 && !shorter.startsWith('..') && !isAbsolute(shorter) ? shorter : path;
}
