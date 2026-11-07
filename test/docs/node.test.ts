/**
 * The documentation examples that need Node.js (files, streams, the CLI), run in a temporary
 * working directory that holds the dictionaries they open. Their source is the
 * documentation's: see `sync.test.ts`.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl } from '../../src/index.js';
import { run } from '../cli/helpers.js';
import { EN_DE, EN_DE_ABBREVIATIONS, gzip, latin1, OLD_DE } from './fixtures.js';
import { blockOf, captureLog } from './helpers.js';

const log = captureLog();
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

let directory: string;
let previous: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dsl-dicts-docs-'));
  mkdirSync(join(directory, 'dictionaries'));
  writeFileSync(join(directory, 'dictionaries', 'en-de.dsl.dz'), await gzip(EN_DE));
  writeFileSync(join(directory, 'dictionaries', 'en-de.dsl'), EN_DE);
  writeFileSync(join(directory, 'dictionaries', 'en-de_abrv.dsl'), EN_DE_ABBREVIATIONS);
  writeFileSync(join(directory, 'dictionaries', 'old-de.dsl'), latin1(OLD_DE));
  previous = process.cwd();
  process.chdir(directory);
});

afterAll(() => {
  process.chdir(previous);
  rmSync(directory, { recursive: true, force: true });
});

describe('README', () => {
  it('quick start in Node.js', async () => {
    await import('./examples/readme-node.js');
    expect(log.calls().map(([line]) => line)).toEqual(
      blockOf(readme, 'readme-node-output').split('\n'),
    );
  });

  it('encodings', async () => {
    await import('./examples/readme-encodings.js');
    expect(log.calls()).toEqual([
      [expect.objectContaining({ encoding: 'windows-1252', source: 'default' })],
      ['option'],
    ]);
  });

  it('JSONL export', async () => {
    await import('./examples/readme-jsonl.js');
    const lines = readFileSync('en-de.article.jsonl', 'utf8').trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      'header',
      'entry',
      'entry',
      'summary',
    ]);
  });
});

describe('docs/jsonl.md', () => {
  // After the JSONL export of the README, which writes the file it reads.
  it('reading JSONL', async () => {
    await import('./examples/jsonl-read.js');
    expect(log.calls()).toEqual([
      ['Tiny English-German', { name: 'article', version: '1.0.0' }],
      ['cat'],
      ['colo(u)r'],
      ['2 entries', {}],
    ]);
  });

  it('JSON', async () => {
    await import('./examples/jsonl-json.js');
    expect(log.calls()).toEqual([[{ name: 'plain-text', version: '1.0.0' }, 2]]);
  });
});

describe('docs/cli.md', () => {
  it('a plugin of your own', async () => {
    copyFileSync(
      new URL('./examples/cli-plugin.mjs', import.meta.url),
      join(directory, 'headword-lengths.mjs'),
    );
    const result = await run(
      [
        'convert',
        'dictionaries/en-de.dsl.dz',
        '--plugin',
        './headword-lengths.mjs',
        '-o',
        'lengths/',
      ],
      directory,
    );
    expect(result.code, result.stderr).toBe(0);
    const text = readFileSync(join(directory, 'lengths', 'en-de.headword-lengths.jsonl'), 'utf8');
    const { header, records } = await readJsonl([text]);
    expect(header.plugin).toEqual({ name: 'headword-lengths', version: '1.0.0' });
    const data: unknown[] = [];
    for await (const record of records) if (record.type === 'entry') data.push(record.data);
    expect(data).toEqual([
      { headword: 'cat', length: 3 },
      { headword: 'color', length: 5 },
    ]);
  });
});

describe('MIGRATION.md', () => {
  it('reading a dictionary', async () => {
    await import('./examples/migration-quick.js');
    expect(log.calls()).toEqual([
      ['Tiny English-German', 'English', 'German'],
      [['cat'], [], 2],
      [['colo(u)r'], [], 1],
    ]);
  });
});
