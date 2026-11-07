/**
 * Exit codes of the CLI, and the errors that carry them.
 *
 * @packageDocumentation
 */

import { isAbsolute, relative } from 'node:path';
import { DslError } from '../../index.js';

/** Process exit codes of `dsl-dicts`. */
export const EXIT = {
  /** Success. */
  ok: 0,
  /** Usage error: unknown command or option, a missing or invalid argument. */
  usage: 1,
  /** Dictionary or I/O error: unreadable input, a strict-mode failure, output that cannot be written. */
  dictionary: 2,
  /** Plugin error: the plugin cannot be loaded, or fails while setting up or processing. */
  plugin: 3,
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

/** The exit code an error ends the CLI with. */
export function exitCodeOf(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof DslError) {
    switch (error.code) {
      // A plugin that fails, or whose output is no JSON.
      case 'DSL5001':
      case 'DSL5002':
      case 'DSL7006':
        return EXIT.plugin;
      // An option the library refuses: the encoding, mostly.
      case 'DSL0001':
      case 'DSL1002':
      case 'DSL1003':
        return EXIT.usage;
      default:
        return EXIT.dictionary;
    }
  }
  return EXIT.dictionary;
}

/** Whether an error is a closed output pipe (`dsl-dicts … | head`). */
export function isBrokenPipe(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

/** The message of an error, with its code for a `DslError`. */
export function describeError(error: unknown): string {
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
