import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/index.js';
import { run } from './helpers.js';

describe('usage', () => {
  it('prints the version', async () => {
    for (const flag of ['--version', '-v']) {
      expect(await run([flag])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    }
  });

  it('prints the usage with the commands and the exit codes', async () => {
    for (const args of [['--help'], ['-h'], ['help']]) {
      const { code, stdout, stderr } = await run(args);
      expect(code, args.join(' ')).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('convert <file|dir>');
      expect(stdout).toContain('info <file>');
      expect(stdout).toMatch(/Exit codes:\n\s+0 .*\n\s+1 .*\n\s+2 .*\n\s+3 /);
    }
  });

  it('prints the help of each command', async () => {
    for (const args of [
      ['convert', '--help'],
      ['convert', '-h'],
      ['help', 'convert'],
    ]) {
      const { code, stdout } = await run(args);
      expect(code).toBe(0);
      expect(stdout).toContain('Usage: dsl-dicts convert');
    }
    const convert = (await run(['convert', '--help'])).stdout;
    for (const option of [
      '--output',
      '--format',
      '--view',
      '--plugin ',
      '--plugin-options',
      '--encoding',
      '--default-encoding',
      '--no-positions',
      '--no-companions',
      '--strict',
      '--summary',
      '--recursive',
      '--verbose',
      '--quiet',
    ]) {
      expect(convert, option).toContain(option);
    }
    // Loading a plugin runs its code: the help says so.
    expect(convert).toContain('code is executed');
    expect(convert).toContain('Exit codes:');
    expect((await run(['info', '--help'])).stdout).toContain('Usage: dsl-dicts info');
  });

  it('exits 1 without a command, with the usage on standard error', async () => {
    const { code, stdout, stderr } = await run([]);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage: dsl-dicts');
  });

  it('exits 1 for an unknown command or option', async () => {
    for (const args of [['frobnicate'], ['--bogus'], ['convert', '--bogus', 'x']]) {
      const { code, stdout, stderr } = await run(args);
      expect(code, args.join(' ')).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toMatch(/^dsl-dicts: /);
    }
  });
});
