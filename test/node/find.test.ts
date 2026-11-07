import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDictionaries } from '../../src/node/index.js';
import { tempDir, writeFiles } from './helpers.js';

describe('findDictionaries', () => {
  const files = {
    'b.dsl': 'x',
    'a.dsl.dz': 'x',
    'A_abrv.dsl': 'x',
    'a_abrv.dsl.dz': 'x',
    'C.DSL': 'x',
    'd.dsl.gz': 'x',
    'a.ann': 'x',
    'a.bmp': 'x',
    'a.dsl.files.zip': 'x',
    'notes.txt': 'x',
    'sub/e.dsl': 'x',
    'sub/e_abrv.dsl': 'x',
    'sub/deep/f.dsl.dz': 'x',
    'sub/deep/g.ann': 'x',
    'g/h.dsl': 'x',
  };

  it('lists the main dictionary files of a directory', async () => {
    const dir = tempDir();
    writeFiles(dir, files);
    const found = await findDictionaries(dir);
    // Sorted by code unit: upper case first.
    expect(found).toEqual(['C.DSL', 'a.dsl.dz', 'b.dsl', 'd.dsl.gz'].map((n) => join(dir, n)));
  });

  it('looks into subdirectories when recursive', async () => {
    const dir = tempDir();
    writeFiles(dir, files);
    const found = await findDictionaries(dir, { recursive: true });
    expect(found.map((p) => p.slice(dir.length + 1).replaceAll('\\', '/'))).toEqual([
      'C.DSL',
      'a.dsl.dz',
      'b.dsl',
      'd.dsl.gz',
      'g/h.dsl',
      'sub/e.dsl',
      'sub/deep/f.dsl.dz',
    ]);
  });

  it('lists a dictionary in several forms once, as the uncompressed file if there is one', async () => {
    const dir = tempDir();
    writeFiles(dir, {
      'x.dsl': 'x',
      'x.dsl.dz': 'x',
      'x.DSL.GZ': 'x',
      'y.dsl.gz': 'x',
      'y.dsl.dz': 'x',
      'Z.DSL.DZ': 'x',
      'z.dsl': 'x',
      'w.DSL': 'x',
      'w.dsl.dz': 'x',
      'sub/x.dsl.dz': 'x',
      'sub/x_abrv.dsl': 'x',
    });
    const names = (found: string[]) =>
      found.map((p) => p.slice(dir.length + 1).replaceAll('\\', '/'));
    expect(names(await findDictionaries(dir))).toEqual(['w.DSL', 'x.dsl', 'y.dsl.dz', 'z.dsl']);
    expect(names(await findDictionaries(dir, { recursive: true }))).toEqual([
      'w.DSL',
      'x.dsl',
      'y.dsl.dz',
      'z.dsl',
      'sub/x.dsl.dz',
    ]);
  });

  it('returns nothing for an empty directory, and does not list directories', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'x.dsl/inner.txt': 'x' });
    expect(await findDictionaries(dir)).toEqual([]);
    expect(await findDictionaries(dir, { recursive: true })).toEqual([]);
  });

  it('fails for a directory that cannot be read, and for invalid arguments', async () => {
    const dir = tempDir();
    expect(await findDictionaries(join(dir, 'nope')).catch((e: unknown) => e)).toMatchObject({
      code: 'DSL1001',
    });
    for (const call of [
      () => findDictionaries(''),
      () => findDictionaries(1 as never),
      () => findDictionaries(dir, null as never),
      () => findDictionaries(dir, { recursive: 1 as never }),
    ]) {
      expect(await call().catch((e: unknown) => e)).toMatchObject({ code: 'DSL0001' });
    }
  });
});
