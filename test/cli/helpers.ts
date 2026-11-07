/**
 * Test helpers for the CLI: running it in-process and as a child process.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readJsonl } from '../../src/index.js';
import { runCli } from '../../src/node/cli/index.js';

export { ABRV, ANNOTATION, DICT, tempDir, writeFiles } from '../node/helpers.js';

export const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js');
/** The spawned CLI is the built one: `npm run ci` builds before testing. */
export const built = existsSync(CLI);

/** A writable that keeps what is written, as text. */
export class Capture extends Writable {
  readonly chunks: string[] = [];
  override _write(chunk: Buffer | string, _encoding: string, done: () => void): void {
    this.chunks.push(chunk.toString());
    done();
  }
  get text(): string {
    return this.chunks.join('');
  }
}

export interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the CLI in this process. */
export async function run(args: readonly string[], cwd = process.cwd()): Promise<Result> {
  const stdout = new Capture();
  const stderr = new Capture();
  const code = await runCli(args, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** Runs `node dist/cli.js` as a child process. */
export function spawnCli(args: readonly string[], cwd = process.cwd()): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
      }),
    );
  });
}

/** Reads a JSONL text with the library's reader. */
export async function records(text: string) {
  const { header, records: body } = await readJsonl([text]);
  const list = [];
  for await (const record of body) list.push(record);
  return { header, records: list };
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/** Writes UTF-8 text files (plugin modules), unlike `writeFiles`, which writes DSL as UTF-16. */
export function writeText(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}
