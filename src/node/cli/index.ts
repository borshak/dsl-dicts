/**
 * The `dsl-dicts` command line: the testable core of `src/cli.ts`.
 *
 * @packageDocumentation
 */

import { VERSION } from '../../index.js';
import { convert } from './convert.js';
import { CliError, describeError, EXIT, exitCodeOf } from './errors.js';
import { info } from './info.js';
import type { CliIo } from './io.js';
import { parseConvert, parseInfo } from './options.js';
import { CONVERT_USAGE, INFO_USAGE, USAGE } from './usage.js';

export { EXIT } from './errors.js';
export type { CliIo } from './io.js';

/**
 * Runs the CLI.
 *
 * @param argv - The arguments after the program name.
 * @param io - The streams and the working directory.
 * @returns The exit code (`EXIT`, stable): 0 success, 1 usage error, 2 dictionary or I/O
 * error, 3 plugin error, 70 internal error.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
        io.stderr.write(USAGE);
        return EXIT.usage;
      case '-h':
      case '--help':
      case 'help':
        io.stdout.write(helpOf(rest[0]) ?? USAGE);
        return EXIT.ok;
      case '-v':
      case '--version':
        io.stdout.write(`${VERSION}\n`);
        return EXIT.ok;
      case 'convert': {
        const options = parseConvert(rest);
        if (options === 'help') return help(io, CONVERT_USAGE);
        return await convert(options, io);
      }
      case 'info': {
        const options = parseInfo(rest);
        if (options === 'help') return help(io, INFO_USAGE);
        return await info(options, io);
      }
      default:
        throw new CliError(EXIT.usage, `Unknown command: ${command}`);
    }
  } catch (error) {
    const code = exitCodeOf(error);
    io.stderr.write(
      `dsl-dicts: ${error instanceof CliError ? error.message : describeError(error)}\n`,
    );
    if (code === EXIT.usage) {
      const scope = command === 'convert' || command === 'info' ? `${command} ` : '';
      io.stderr.write(`Run "dsl-dicts ${scope}--help" for usage.\n`);
    }
    return code;
  }
}

function help(io: CliIo, text: string): number {
  io.stdout.write(text);
  return EXIT.ok;
}

function helpOf(command: string | undefined): string | undefined {
  return command === 'convert' ? CONVERT_USAGE : command === 'info' ? INFO_USAGE : undefined;
}
