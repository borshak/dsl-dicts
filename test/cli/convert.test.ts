import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AST_VERSION, VERSION } from '../../src/index.js';
import { runCli } from '../../src/node/cli/index.js';
import { encode } from '../decode/helpers.js';
import {
  ABRV,
  Capture,
  DICT,
  readText,
  records,
  run,
  tempDir,
  writeFiles,
  writeText,
} from './helpers.js';

const NOISY = `${DICT}bird\n\t[b]unclosed\n`;

function dictionary(files: Record<string, string> = { 'a.dsl': DICT }) {
  const dir = tempDir();
  writeFiles(dir, files);
  return dir;
}

describe('convert: a file to standard output', () => {
  it('writes AST JSONL by default', async () => {
    const dir = dictionary();
    const { code, stdout, stderr } = await run(['convert', 'a.dsl'], dir);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const { header, records: list } = await records(stdout);
    expect(header).toMatchObject({
      format: 'dsl-dicts/jsonl',
      formatVersion: 1,
      astVersion: AST_VERSION,
      plugin: null,
      generator: { name: 'dsl-dicts', version: VERSION },
      dictionary: { name: 'Synthetic', indexLanguage: 'English', contentsLanguage: 'Russian' },
      decode: { encoding: 'utf-16le', source: 'bom', compression: 'none' },
    });
    expect(list.map((r) => r.type)).toEqual(['entry', 'entry']);
    expect(list[0]).toMatchObject({ data: { headwords: [{ text: 'cat' }] } });
  });

  it.each([
    ['article', 'article'],
    ['plain-text', 'plain-text'],
    ['search-text', 'search-text'],
  ])('exports the %s view', async (view, name) => {
    const dir = dictionary();
    const { code, stdout } = await run(['convert', 'a.dsl', '--view', view], dir);
    expect(code).toBe(0);
    const { header, records: list } = await records(stdout);
    expect(header.plugin?.name).toBe(name);
    expect(list).toHaveLength(2);
  });

  it('passes --plugin-options to a built-in plugin, with the companions loaded', async () => {
    const dir = dictionary({ 'a.dsl': `${DICT}rat\n\t[p]n[/p] x\n`, 'a_abrv.dsl': ABRV });
    const args = ['convert', 'a.dsl', '--view', 'plain-text', '--plugin-options'];
    const withLabels = await run([...args, '{"expandLabels":true}'], dir);
    expect((await records(withLabels.stdout)).records.at(-1)).toMatchObject({
      data: { text: 'существительное x' },
    });
    const without = await run([...args, '{"expandLabels":true}', '--no-companions'], dir);
    expect((await records(without.stdout)).records.at(-1)).toMatchObject({ data: { text: 'n x' } });
  });

  it('writes one JSON document with --format json, indented with --pretty', async () => {
    const dir = dictionary();
    const compact = await run(
      ['convert', 'a.dsl', '--format', 'json', '--view', 'plain-text'],
      dir,
    );
    const doc = JSON.parse(compact.stdout);
    expect(doc.header.plugin.name).toBe('plain-text');
    expect(doc.entries).toEqual([
      { headwords: ['cat'], text: 'n кошка' },
      { headwords: ['dog'], text: 'n. собака' },
    ]);
    const pretty = await run(
      ['convert', 'a.dsl', '--format', 'json', '--view', 'plain-text', '--pretty'],
      dir,
    );
    expect(pretty.stdout).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });

  it('ends with a summary when asked: entries and diagnostics by code', async () => {
    const dir = dictionary({ 'a.dsl': NOISY, 'a_abrv.dsl': `${ABRV}n\n\tagain\n` });
    for (const view of ['ast', 'article']) {
      const { stdout } = await run(['convert', 'a.dsl', '--summary', '--view', view], dir);
      const { records: list } = await records(stdout);
      // The companion's DSL6001 and the entry's DSL4202, though the output is not the AST.
      expect(list.at(-1)).toEqual({
        type: 'summary',
        entries: 3,
        diagnostics: { DSL4202: 1, DSL6001: 1 },
      });
    }
  });

  it('leaves positions out of the AST with --no-positions', async () => {
    const dir = dictionary();
    const withPositions = await run(['convert', 'a.dsl'], dir);
    const without = await run(['convert', 'a.dsl', '--no-positions'], dir);
    type First = { data: { position?: unknown; headwords: { position?: unknown }[] } };
    const first = async (text: string) => (await records(text)).records[0] as unknown as First;
    expect((await first(withPositions.stdout)).data.headwords[0]?.position).toBeDefined();
    expect((await first(without.stdout)).data.headwords[0]?.position).toBeUndefined();
    expect((await first(without.stdout)).data.position).toBeDefined();
  });

  it('lets --encoding override detection, and --default-encoding set the fallback', async () => {
    const dir = dictionary({ 'u.dsl': '#NAME "n"\nпривет\n\tмир\n' });
    const text = (r: { stdout: string }) => records(r.stdout);
    const auto = await text(await run(['convert', 'u.dsl', '--view', 'plain-text'], dir));
    expect(auto.records[0]).toMatchObject({ data: { headwords: ['привет'] } });
    const forced = await text(
      await run(['convert', 'u.dsl', '--view', 'plain-text', '--encoding', 'cp1251'], dir),
    );
    expect(forced.header.decode).toMatchObject({ encoding: 'windows-1251', source: 'option' });
    expect(forced.records[0]).not.toMatchObject({ data: { headwords: ['привет'] } });

    const bytes = encode('#NAME "n"\nпривет\n\tмир\n', 'windows-1251');
    writeFiles(dir, { 'c.dsl': bytes });
    const fallback = await text(
      await run(
        ['convert', 'c.dsl', '--view', 'plain-text', '--default-encoding', 'Cyrillic'],
        dir,
      ),
    );
    expect(fallback.records[0]).toMatchObject({ data: { headwords: ['привет'] } });
    const bad = await run(['convert', 'u.dsl', '--encoding', 'nonsense'], dir);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('DSL1002');
  });

  it('reads compressed dictionaries', async () => {
    const dir = dictionary({ 'a.dsl.dz': DICT });
    const { header } = await records((await run(['convert', 'a.dsl.dz'], dir)).stdout);
    expect(header.decode.compression).toBe('gzip');
  });
});

describe('convert: a file to a file', () => {
  it('writes -o, creating directories, and keeps standard output empty', async () => {
    const dir = dictionary();
    const { code, stdout, stderr } = await run(['convert', 'a.dsl', '-o', 'out/deep/x.jsonl'], dir);
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('2 entries');
    const { records: list } = await records(await readText(join(dir, 'out/deep/x.jsonl')));
    expect(list).toHaveLength(2);
  });

  it('writes <base>.<view>.jsonl into an -o that is a directory', async () => {
    const dir = dictionary();
    await mkdir(join(dir, 'existing'));
    await run(['convert', 'a.dsl', '-o', 'existing', '--view', 'article'], dir);
    await run(['convert', 'a.dsl', '-o', 'fresh/', '--format', 'json'], dir);
    expect(existsSync(join(dir, 'existing/a.article.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'fresh/a.ast.json'))).toBe(true);
  });

  it('is quiet with --quiet', async () => {
    const dir = dictionary({ 'a.dsl': NOISY });
    const { stderr } = await run(['convert', 'a.dsl', '-o', 'x.jsonl', '--quiet'], dir);
    expect(stderr).toBe('');
  });
});

describe('convert: diagnostics', () => {
  it('summarizes them on standard error by default', async () => {
    const dir = dictionary({ 'a.dsl': NOISY });
    const { code, stderr } = await run(['convert', 'a.dsl'], dir);
    expect(code).toBe(0);
    expect(stderr).toBe('a.dsl: 1 diagnostic (DSL4202 x1); use --verbose to list them\n');
  });

  it('prints each with its position when --verbose, and nothing when --quiet', async () => {
    const dir = dictionary({ 'a.dsl': NOISY });
    const verbose = await run(['convert', 'a.dsl', '--verbose', '--view', 'plain-text'], dir);
    expect(verbose.stderr).toMatch(/^a\.dsl:9:\d+: warning DSL4202 .+\n$/);
    const quiet = await run(['convert', 'a.dsl', '--quiet'], dir);
    expect(quiet.stderr).toBe('');
    expect(quiet.code).toBe(0);
  });

  it('counts the diagnostics of companion files', async () => {
    const dir = dictionary({ 'a.dsl': DICT, 'a_abrv.dsl': `${ABRV}n\n\tagain\n` });
    const { stderr } = await run(['convert', 'a.dsl'], dir);
    expect(stderr).toContain('DSL6001 x1');
  });

  it('does not report the missing header of an abbreviations file', async () => {
    const dir = dictionary({ 'a.dsl': DICT, 'a_abrv.dsl': 'n\n\tnoun\n' });
    const { stderr } = await run(['convert', 'a.dsl', '--verbose'], dir);
    expect(stderr).toBe('');
  });

  it('fails with exit code 2 in --strict mode, removing a partial file', async () => {
    const dir = dictionary({ 'a.dsl': `${DICT}x\n\t{{ never closed\n` });
    const out = await run(['convert', 'a.dsl', '--strict', '-o', 'x.jsonl'], dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain('DSL2101');
    expect(existsSync(join(dir, 'x.jsonl'))).toBe(false);
    const std = await run(['convert', 'a.dsl', '--strict'], dir);
    expect(std.code).toBe(2);
    expect(std.stdout).toContain('"headwords"'); // the entries before the failure were written
    expect(std.stdout).not.toContain('"summary"');
    expect((await run(['convert', 'a.dsl'], dir)).code).toBe(0);
  });

  it('exits 2 when the output cannot be written', async () => {
    const dir = dictionary();
    const { code, stderr } = await run(['convert', 'a.dsl', '-o', 'a.dsl/x.jsonl'], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^dsl-dicts: a\.dsl: /);
  });

  it('exits 2 for a file that does not exist or cannot be opened', async () => {
    const dir = dictionary();
    const missing = await run(['convert', 'nope.dsl'], dir);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('nope.dsl');
  });
});

describe('convert: a directory', () => {
  const files = {
    'a.dsl': DICT,
    'a.dsl.dz': DICT,
    'a_abrv.dsl': ABRV,
    'b.dsl.dz': DICT,
    'sub/c.dsl': DICT,
    'sub/deep/c.dsl': DICT,
    'notes.txt': 'x',
  };

  it('needs -o', async () => {
    const dir = dictionary(files);
    const { code, stderr } = await run(['convert', '.'], dir);
    expect(code).toBe(1);
    expect(stderr).toContain('-o');
  });

  it('converts each dictionary once to <base>.<view>.jsonl', async () => {
    const dir = dictionary(files);
    const { code, stderr } = await run(['convert', '.', '-o', 'out', '--view', 'article'], dir);
    expect(code).toBe(0);
    expect((await readdir(join(dir, 'out'))).sort()).toEqual([
      'a.article.jsonl',
      'b.article.jsonl',
    ]);
    expect(stderr).toContain('Converted 2 of 2 dictionaries');
    const { header } = await records(await readText(join(dir, 'out/a.article.jsonl')));
    // The uncompressed a.dsl was used, not a.dsl.dz.
    expect(header.decode.compression).toBe('none');
  });

  it('looks into subdirectories when --recursive, keeping their layout', async () => {
    const dir = dictionary(files);
    const { code } = await run(
      ['convert', '.', '-o', 'out', '--recursive', '--format', 'json'],
      dir,
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'out/a.ast.json'))).toBe(true);
    expect(existsSync(join(dir, 'out/sub/c.ast.json'))).toBe(true);
    expect(existsSync(join(dir, 'out/sub/deep/c.ast.json'))).toBe(true);
    expect(JSON.parse(await readText(join(dir, 'out/b.ast.json'))).entries).toHaveLength(2);
  });

  it('goes on after a dictionary that fails, and exits 2', async () => {
    const dir = dictionary({ 'a.dsl': DICT, 'bad.dsl': `${DICT}x\n\t{{ open`, 'z.dsl': DICT });
    const { code, stderr } = await run(['convert', '.', '-o', 'out', '--strict'], dir);
    expect(code).toBe(2);
    expect(stderr).toContain('bad.dsl');
    expect(stderr).toContain('Converted 2 of 3');
    expect((await readdir(join(dir, 'out'))).sort()).toEqual(['a.ast.jsonl', 'z.ast.jsonl']);
  });

  it('exits 2 when there is nothing to convert', async () => {
    const dir = dictionary({ 'notes.txt': 'x' });
    const { code, stderr } = await run(['convert', '.', '-o', 'out'], dir);
    expect(code).toBe(2);
    expect(stderr).toContain('No dictionaries');
  });

  it('is quiet with --quiet and names the files with --verbose', async () => {
    const dir = dictionary(files);
    expect((await run(['convert', '.', '-o', 'q', '--quiet'], dir)).stderr).toBe('');
    const verbose = await run(['convert', '.', '-o', 'v', '--verbose'], dir);
    expect(verbose.stderr).toContain('a.dsl -> v');
  });
});

describe('convert: plugins from a module', () => {
  const PLUGIN = `export default {
  name: 'my-plugin',
  version: '2.1.0',
  setup(context, options) {
    const suffix = options?.suffix ?? '';
    return (entry) => ({ first: entry.headwords[0].text + suffix, dictionary: context.header.name });
  },
};
`;

  it('exports the output of a plugin and records it in the header', async () => {
    const dir = dictionary({ 'a.dsl': DICT });
    writeText(dir, { 'p.mjs': PLUGIN });
    const { code, stdout } = await run(
      ['convert', 'a.dsl', '--plugin', './p.mjs', '--plugin-options', '{"suffix":"!"}'],
      dir,
    );
    expect(code).toBe(0);
    const { header, records: list } = await records(stdout);
    expect(header.plugin).toEqual({ name: 'my-plugin', version: '2.1.0' });
    expect(list.map((r) => (r as { data: unknown }).data)).toEqual([
      { first: 'cat!', dictionary: 'Synthetic' },
      { first: 'dog!', dictionary: 'Synthetic' },
    ]);
    const named = await run(['convert', 'a.dsl', '--plugin', 'p.mjs', '-o', 'out.jsonl'], dir);
    expect(named.code).toBe(0);
  });

  it('names the output files after the plugin', async () => {
    const dir = dictionary({ 'a.dsl': DICT });
    writeText(dir, { 'p.mjs': PLUGIN });
    await run(['convert', '.', '-o', 'out', '--plugin', 'p.mjs'], dir);
    expect(existsSync(join(dir, 'out/a.my-plugin.jsonl'))).toBe(true);
  });

  it('exits 3 for a module that cannot be loaded or is not a plugin', async () => {
    const dir = dictionary({ 'a.dsl': DICT });
    writeText(dir, {
      'broken.mjs': 'export default {{{',
      'throws.mjs': 'throw new Error("boom");',
      'none.mjs': 'export const x = 1;',
      'shape.mjs': 'export default { name: "x y", version: "1.0.0", setup() {} };',
    });
    for (const file of ['missing.mjs', 'broken.mjs', 'throws.mjs', 'none.mjs', 'shape.mjs']) {
      const { code, stderr, stdout } = await run(['convert', 'a.dsl', '--plugin', file], dir);
      expect(code, file).toBe(3);
      expect(stderr, file).toContain(file);
      expect(stdout, file).toBe('');
    }
  });

  it('exits 3 when the plugin fails, or returns what is not JSON', async () => {
    const dir = dictionary({ 'a.dsl': DICT });
    writeText(dir, {
      'fail.mjs':
        'export default { name: "f", version: "1.0.0", setup: () => () => { throw new Error("no"); } };',
      'setup.mjs':
        'export default { name: "s", version: "1.0.0", setup() { throw new Error("bad options"); } };',
      'big.mjs': 'export default { name: "b", version: "1.0.0", setup: () => () => 10n };',
    });
    for (const [file, text] of [
      ['fail.mjs', 'DSL5002'],
      ['setup.mjs', 'DSL5001'],
      ['big.mjs', 'DSL7006'],
    ] as const) {
      const { code, stderr } = await run(['convert', 'a.dsl', '--plugin', file], dir);
      expect(code, file).toBe(3);
      expect(stderr, file).toContain(text);
    }
  });

  it('exits 3 for options a built-in plugin refuses', async () => {
    const dir = dictionary();
    const { code, stderr } = await run(
      ['convert', 'a.dsl', '--view', 'plain-text', '--plugin-options', '{"bogus":1}'],
      dir,
    );
    expect(code).toBe(3);
    expect(stderr).toContain('plain-text');
  });
});

describe('convert: usage errors (exit 1)', () => {
  it.each([
    [['convert']],
    [['convert', 'a.dsl', 'b.dsl']],
    [['convert', 'a.dsl', '--format', 'xml']],
    [['convert', 'a.dsl', '--view', 'html']],
    [['convert', 'a.dsl', '--view', 'article', '--plugin', 'p.mjs']],
    [['convert', 'a.dsl', '--plugin-options', '{}']],
    [['convert', 'a.dsl', '--view', 'article', '--plugin-options', '{nope']],
    [['convert', 'a.dsl', '--pretty']],
    [['convert', 'a.dsl', '--verbose', '--quiet']],
    [['convert', 'a.dsl', '--bogus']],
    [['convert', 'a.dsl', '-o']],
  ])('%j', async (args) => {
    const dir = dictionary();
    const { code, stderr, stdout } = await run(args, dir);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^dsl-dicts: /);
    expect(stderr).toContain('--help');
  });
});

describe('convert: a closed output', () => {
  it('stops quietly when the reader of standard output has gone (EPIPE)', async () => {
    const dir = dictionary({
      'a.dsl': DICT + Array.from({ length: 5000 }, (_, i) => `w${i}\n\tbody ${i}\n`).join(''),
    });
    let writes = 0;
    // A closed pipe: the first write fails with EPIPE, as it does on a real stream.
    const stdout = new Writable({
      write(_chunk, _encoding, done) {
        writes++;
        done(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      },
    });
    const stderr = new Capture();
    const code = await runCli(['convert', 'a.dsl'], { stdout, stderr, cwd: dir });
    expect(code).toBe(0);
    expect(stderr.text).toBe('');
    expect(writes).toBe(1);
  });
});

describe('convert: backpressure', () => {
  it('waits for a slow reader instead of buffering the output', async () => {
    const dir = dictionary({
      'a.dsl': DICT + Array.from({ length: 4000 }, (_, i) => `w${i}\n\tbody ${i}\n`).join(''),
    });
    let pending = 0;
    let maxPending = 0;
    const stdout = new Writable({
      highWaterMark: 1024,
      write(chunk: Buffer, _encoding, done) {
        pending += chunk.length;
        maxPending = Math.max(maxPending, pending);
        setTimeout(() => {
          pending -= chunk.length;
          done();
        }, 1);
      },
    });
    const code = await runCli(['convert', 'a.dsl'], { stdout, stderr: new Capture(), cwd: dir });
    expect(code).toBe(0);
    // Chunks are gathered up to 64 KiB; the writes were never queued without limit.
    expect(maxPending).toBeLessThan(200 * 1024);
  });
});
