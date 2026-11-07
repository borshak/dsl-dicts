/**
 * The built CLI, run as a child process on temporary synthetic dictionaries: what a user gets
 * from `npx dsl-dicts`. Needs `npm run build` (`npm run ci` builds before it tests).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/index.js';
import {
  ABRV,
  built,
  CLI,
  DICT,
  readText,
  records,
  spawnCli,
  tempDir,
  writeFiles,
  writeText,
} from './helpers.js';

if (!built) console.warn(`${CLI} is missing: run "npm run build" to test the CLI as a process.`);

describe.skipIf(!built)('dsl-dicts as a process', () => {
  it('prints the version and the help', async () => {
    expect(await spawnCli(['--version'])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    const help = await spawnCli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: dsl-dicts');
  });

  it.each(['ast', 'article', 'plain-text', 'search-text'])(
    'converts with --view %s',
    async (view) => {
      const dir = tempDir();
      writeFiles(dir, { 'a.dsl': DICT, 'a_abrv.dsl': ABRV });
      const { code, stdout, stderr } = await spawnCli(
        ['convert', 'a.dsl', '--view', view, '--summary'],
        dir,
      );
      expect(code).toBe(0);
      expect(stderr).toBe('');
      const { header, records: list } = await records(stdout);
      expect(header.plugin?.name ?? 'ast').toBe(view);
      expect(list.map((r) => r.type)).toEqual(['entry', 'entry', 'summary']);
    },
  );

  it('converts to a file, as json too', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'a.dsl.dz': DICT });
    const jsonl = await spawnCli(
      ['convert', 'a.dsl.dz', '--view', 'article', '-o', 'out.jsonl', '-q'],
      dir,
    );
    expect(jsonl).toEqual({ code: 0, stdout: '', stderr: '' });
    expect((await records(await readText(join(dir, 'out.jsonl')))).records).toHaveLength(2);
    await spawnCli(['convert', 'a.dsl.dz', '--format', 'json', '-o', 'out.json'], dir);
    expect(JSON.parse(await readText(join(dir, 'out.json'))).entries).toHaveLength(2);
  });

  it('converts a directory, once per dictionary', async () => {
    const dir = tempDir();
    writeFiles(dir, {
      'a.dsl': DICT,
      'a.dsl.dz': DICT,
      'sub/b.dsl.dz': DICT,
      'sub/b_abrv.dsl': ABRV,
    });
    const { code, stderr } = await spawnCli(
      ['convert', '.', '-o', 'out', '--recursive', '--view', 'article'],
      dir,
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Converted 2 of 2');
    for (const file of ['out/a.article.jsonl', 'out/sub/b.article.jsonl']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
      await records(await readText(join(dir, file)));
    }
  });

  it('loads a plugin module', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'a.dsl': DICT });
    writeText(dir, {
      'p.mjs':
        'export default { name: "heads", version: "3.0.0", setup: () => (e) => e.headwords.map((h) => h.text) };',
    });
    const { code, stdout } = await spawnCli(['convert', 'a.dsl', '--plugin', './p.mjs'], dir);
    expect(code).toBe(0);
    const { header, records: list } = await records(stdout);
    expect(header.plugin).toEqual({ name: 'heads', version: '3.0.0' });
    expect(list).toEqual([
      { type: 'entry', data: ['cat'] },
      { type: 'entry', data: ['dog'] },
    ]);
  });

  it('ends with the documented exit codes', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'a.dsl': DICT, 'bad.dsl': `${DICT}x\n\t{{ open` });
    writeText(dir, { 'none.mjs': 'export const x = 1;' });
    const code = async (...args: string[]) => (await spawnCli(args, dir)).code;
    expect(await code('convert', 'a.dsl')).toBe(0);
    expect(await code('convert')).toBe(1);
    expect(await code('convert', 'a.dsl', '--view', 'nope')).toBe(1);
    expect(await code('convert', 'missing.dsl')).toBe(2);
    expect(await code('convert', 'bad.dsl', '--strict')).toBe(2);
    expect(await code('convert', 'a.dsl', '--plugin', 'none.mjs')).toBe(3);
    expect(await code('info', 'missing.dsl')).toBe(2);
  });

  it('prints info', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'a.dsl': DICT });
    const { code, stdout } = await spawnCli(['info', 'a.dsl', '--json'], dir);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ entries: 2, dictionary: { name: 'Synthetic' } });
  });
});

describe.skipIf(!built)('dsl-dicts when its output is closed', () => {
  const big = () => {
    const dir = tempDir();
    // About 3 MB of AST: far more than a pipe holds.
    writeFiles(dir, {
      'big.dsl': DICT + Array.from({ length: 6000 }, (_, i) => `w${i}\n\t[m1]body ${i}\n`).join(''),
    });
    return dir;
  };

  it('exits quietly with 0 when the reader of standard output goes away (EPIPE)', async () => {
    const dir = big();
    const child = spawn(process.execPath, [CLI, 'convert', 'big.dsl'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    let first = '';
    await new Promise<void>((resolve) => {
      child.stdout.once('data', (chunk: Buffer) => {
        first = chunk.toString();
        child.stdout.destroy(); // like `head` exiting
        resolve();
      });
    });
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(first.startsWith('{"type":"header"')).toBe(true);
    expect(Buffer.concat(stderr).toString()).toBe('');
    expect(code).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('works in a shell pipeline into head', async () => {
    const dir = big();
    const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>(
      (resolve) => {
        const child = spawn(
          'sh',
          ['-c', `"${process.execPath}" "${CLI}" convert big.dsl --view plain-text | head -n 2`],
          { cwd: dir },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk;
        });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      },
    );
    expect(result.stdout.split('\n').filter(Boolean)).toHaveLength(2);
    expect(result.stderr).toBe('');
  });
});
