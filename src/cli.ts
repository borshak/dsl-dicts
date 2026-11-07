#!/usr/bin/env node
/**
 * Command line interface of dsl-dicts.
 *
 * @packageDocumentation
 */

import { parseArgs } from 'node:util';
import { VERSION } from './index.js';

const USAGE = `Usage: dsl-dicts [options]

Options:
  -h, --help     Show this help and exit
  -v, --version  Print the version and exit
`;

/**
 * Runs the CLI.
 *
 * @param argv - Arguments without the node binary and script path.
 * @returns Process exit code.
 */
export function run(argv: readonly string[]): number {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
    if (values.version) {
      console.log(VERSION);
      return 0;
    }
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    console.error(USAGE);
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }
}

process.exitCode = run(process.argv.slice(2));
