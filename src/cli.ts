#!/usr/bin/env node
/**
 * Command line interface of dsl-dicts. The commands are in `src/node/cli`.
 *
 * @packageDocumentation
 */

import { runCli } from './node/cli/index.js';

// A reader that closes early (`dsl-dicts convert x.dsl | head`) must not crash the process.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});

runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  },
);
