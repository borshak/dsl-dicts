import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AST_VERSION, VERSION } from '../../src/index.js';
import { ABRV, ANNOTATION, DICT, run, tempDir, writeFiles } from './helpers.js';

function setup() {
  const dir = tempDir();
  writeFiles(dir, {
    'a.dsl': `${DICT}bird\n\t[b]unclosed\n`,
    'a_abrv.dsl': ABRV,
    'a.ann': ANNOTATION,
    'a.bmp': 'BM',
    'bare.dsl': '#NAME "Bare"\nx\n\ty\n',
  });
  return dir;
}

describe('info', () => {
  it('prints the header, decoding, companions, entry count and diagnostics', async () => {
    const dir = setup();
    const { code, stdout, stderr } = await run(['info', 'a.dsl'], dir);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Name:');
    expect(stdout).toMatch(/Name:\s+Synthetic/);
    expect(stdout).toMatch(/Index language:\s+English/);
    expect(stdout).toMatch(/Contents language:\s+Russian/);
    expect(stdout).toMatch(/Encoding:\s+utf-16le \(detected by: bom\)/);
    expect(stdout).toMatch(/Entries:\s+3/);
    expect(stdout).toContain(`${join(dir, 'a_abrv.dsl')} (2 abbreviations)`);
    expect(stdout).toContain(`${join(dir, 'a.ann')} (2 sections)`);
    expect(stdout).toMatch(/icon\s+.*a\.bmp/);
    expect(stdout).toMatch(/media\s+-/);
    expect(stdout).toContain('Diagnostics: 1');
    expect(stdout).toMatch(/DSL4202\s+1\s+A tag other than/);
  });

  it('says so when there are no diagnostics, and shows missing directives', async () => {
    const dir = setup();
    const { stdout } = await run(['info', 'a.dsl', '--no-companions'], dir);
    expect(stdout).toMatch(/abbreviations\s+-/);
    const bare = await run(['info', 'bare.dsl'], dir);
    expect(bare.stdout).toMatch(/Index language:\s+\(none\)/);
    expect(bare.stdout).toContain('DSL2001');
  });

  it('prints one JSON document with --format json', async () => {
    const dir = setup();
    const { code, stdout } = await run(['info', 'a.dsl', '--format', 'json'], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({
      file: join(dir, 'a.dsl'),
      generator: { name: 'dsl-dicts', version: VERSION },
      astVersion: AST_VERSION,
      dictionary: { name: 'Synthetic', indexLanguage: 'English', contentsLanguage: 'Russian' },
      decode: { encoding: 'utf-16le', source: 'bom', bom: true, compression: 'none' },
      abbreviations: 2,
      annotationSections: 2,
      entries: 3,
      diagnostics: { total: 1, bySeverity: { warning: 1 }, byCode: { DSL4202: 1 } },
    });
    expect(report.files).toMatchObject({ dictionary: join(dir, 'a.dsl') });
    expect(report.files.annotation).toBe(join(dir, 'a.ann'));
    expect(report.directives.map((d: { name: string }) => d.name)).toEqual([
      'NAME',
      'INDEX_LANGUAGE',
      'CONTENTS_LANGUAGE',
    ]);
  });

  it('prints the diagnostics with --verbose, none with --quiet or by default', async () => {
    const dir = setup();
    const quiet = await run(['info', 'a.dsl'], dir);
    expect(quiet.stderr).toBe('');
    expect((await run(['info', 'a.dsl', '-q'], dir)).stderr).toBe('');
    const verbose = await run(['info', 'a.dsl', '--verbose'], dir);
    expect(verbose.code).toBe(0);
    expect(verbose.stderr).toMatch(/a\.dsl:\d+:\d+: warning DSL4202 /);
    expect(verbose.stdout).toBe(quiet.stdout);
  });

  it('fails in strict mode from the severity given', async () => {
    const dir = setup();
    expect((await run(['info', 'a.dsl', '--strict'], dir)).code).toBe(0);
    const failed = await run(['info', 'a.dsl', '--strict=warning'], dir);
    expect(failed.code).toBe(2);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toContain('DSL4202');
  });

  it('uses the encoding options', async () => {
    const dir = setup();
    const { stdout } = await run(
      ['info', 'a.dsl', '--format', 'json', '--encoding', 'utf-16le'],
      dir,
    );
    expect(JSON.parse(stdout).decode).toMatchObject({ encoding: 'utf-16le', source: 'option' });
  });

  it('exits 2 for a file that cannot be read, and 1 for bad arguments', async () => {
    const dir = setup();
    expect((await run(['info', 'nope.dsl'], dir)).code).toBe(2);
    expect((await run(['info', '.'], dir)).code).toBe(2);
    for (const args of [
      ['info'],
      ['info', 'a.dsl', 'b.dsl'],
      ['info', 'a.dsl', '--bogus'],
      ['info', 'a.dsl', '--json'],
      ['info', 'a.dsl', '--format', 'yaml'],
      ['info', 'a.dsl', '--verbose', '--quiet'],
      ['info', 'a.dsl', '--strict=no'],
    ]) {
      const { code, stdout } = await run(args, dir);
      expect(code, args.join(' ')).toBe(1);
      expect(stdout).toBe('');
    }
  });
});
