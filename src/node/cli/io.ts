/**
 * The streams and the directory the CLI works with, injectable for tests.
 *
 * @packageDocumentation
 */

import type { Writable } from 'node:stream';

/** What the CLI reads and writes. */
export interface CliIo {
  /** Where data goes: converted output without `-o`, `info` output, help. */
  readonly stdout: Writable;
  /** Where messages go: diagnostics, progress, errors. */
  readonly stderr: Writable;
  /** The directory relative paths are resolved against. */
  readonly cwd: string;
}
