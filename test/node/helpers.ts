/**
 * Test helpers for the Node adapter: synthetic dictionaries in temporary directories.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll } from 'vitest';
import { encode } from '../decode/helpers.js';

export const DICT =
  '#NAME "Synthetic"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "Russian"\n' +
  'cat\n\t[m1][p]n[/p] [trn]кошка[/trn]\n' +
  'dog\n\t[m1][p]n.[/p] [trn]собака[/trn]\n';

export const ABRV =
  '#NAME "Abbreviations"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "Russian"\n' +
  'n\n\tсуществительное\n' +
  'n.\n\tсущ.\n';

export const ANNOTATION =
  '#LANGUAGE "English"\nSynthetic dictionary.\n#LANGUAGE "Russian"\nСинтетический.\n';

const temps: string[] = [];

/** Creates a temporary directory, removed after the test file. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsl-dicts-test-'));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

export type FileContent = string | Uint8Array;

/**
 * Writes files into a directory. A string is written as UTF-16LE with a BOM, as Lingvo writes
 * DSL files; a name ending in `.dz` is gzipped (UTF-8 inside); bytes are written as is.
 * Subdirectories are created.
 */
export function writeFiles(dir: string, files: Record<string, FileContent>): void {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    if (typeof content !== 'string') {
      writeFileSync(path, content);
    } else if (name.toLowerCase().endsWith('.dz')) {
      writeFileSync(path, gzipSync(encode(content, 'utf-8')));
    } else {
      writeFileSync(path, encode(content, 'utf-16le', true));
    }
  }
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
