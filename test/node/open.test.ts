import { chmodSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCollectingSink, DslError, parseAbbreviations } from '../../src/index.js';
import { openDsl } from '../../src/node/index.js';
import { plainText, searchText } from '../../src/plugins/index.js';
import { encode, gzip } from '../decode/helpers.js';
import { ABRV, ANNOTATION, collect, DICT, tempDir, writeFiles } from './helpers.js';

/** Opens a dictionary written to a fresh directory. */
async function open(files: Record<string, string | Uint8Array>, name = 'foo.dsl', options = {}) {
  const dir = tempDir();
  writeFiles(dir, files);
  return { dir, dict: await openDsl(join(dir, name), options) };
}

describe('openDsl', () => {
  it('opens a .dsl file with the shape of parseDsl', async () => {
    const { dir, dict } = await open({ 'foo.dsl': DICT });
    expect(await dict.header).toMatchObject({ name: 'Synthetic', indexLanguage: 'English' });
    expect(await dict.info).toMatchObject({ encoding: 'utf-16le', bom: true, compression: 'none' });
    expect(dict.files).toEqual({ dictionary: join(dir, 'foo.dsl') });
    expect(dict.abbreviations).toBeUndefined();
    expect(dict.annotation).toBeUndefined();
    const entries = await collect(dict.entries());
    expect(entries.map((e) => e.headwords[0]?.text)).toEqual(['cat', 'dog']);
    expect(dict.diagnostics).toEqual([]);
  });

  it('reads batches, and raw bodies with the body option', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT });
    const dict = await openDsl(join(dir, 'foo.dsl'), { body: 'raw' });
    const batches = await collect(dict.batches());
    expect(batches.flat().map((e) => e.body[0]?.kind)).toEqual(['text', 'text']);
  });

  it('opens a .dsl.dz file', async () => {
    const { dir, dict } = await open({ 'foo.dsl.dz': DICT }, 'foo.dsl.dz');
    expect(await dict.info).toMatchObject({ compression: 'gzip', encoding: 'utf-8' });
    expect(dict.files.dictionary).toBe(join(dir, 'foo.dsl.dz'));
    expect((await collect(dict.entries())).length).toBe(2);
  });

  it('opens 8-bit files with defaultEncoding', async () => {
    const text = DICT.replace('кошка', 'х').replace('собака', 'у');
    const bytes = encode(`${text}Ж\n\tж\n`, 'windows-1251');
    const { dict } = await open({ 'foo.dsl': bytes });
    const entries = await collect(dict.entries());
    expect(entries.at(-1)?.headwords[0]?.text).toBe('Ж');
  });

  it('resolves relative paths', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT, 'foo.ann': ANNOTATION });
    const dict = await openDsl(join(dir, 'x', '..', 'foo.dsl'));
    expect(dict.files).toEqual({
      dictionary: join(dir, 'foo.dsl'),
      annotation: join(dir, 'foo.ann'),
    });
  });

  it('fails with DSL1001 for a missing file or a directory', async () => {
    const dir = tempDir();
    for (const path of [join(dir, 'nope.dsl'), dir]) {
      const error = await openDsl(path).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DslError);
      expect(error).toMatchObject({ code: 'DSL1001' });
      expect((error as DslError).cause).toBeDefined();
    }
  });

  it('checks its arguments', async () => {
    for (const call of [
      () => openDsl(1 as never),
      () => openDsl(''),
      () => openDsl('x.dsl', null as never),
      () => openDsl('x.dsl', { companions: 'yes' as never }),
      () => openDsl('x.dsl', { companions: { annotation: 1 as never } }),
      () => openDsl('x.dsl', { paths: 1 as never }),
      () => openDsl('x.dsl', { paths: { icon: 1 as never } }),
    ]) {
      expect(await call().catch((e: unknown) => e)).toMatchObject({ code: 'DSL0001' });
    }
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT });
    expect(
      await openDsl(join(dir, 'foo.dsl'), { abbreviations: {} as never }).catch((e: unknown) => e),
    ).toMatchObject({ code: 'DSL0001' });
  });
});

describe('companion discovery', () => {
  it('finds all four companions and loads abbreviations and annotation', async () => {
    const { dir, dict } = await open({
      'foo.dsl': DICT,
      'foo_abrv.dsl': ABRV,
      'foo.ann': ANNOTATION,
      'foo.bmp': new Uint8Array([0x42, 0x4d]),
      'foo.dsl.files.zip': new Uint8Array([0x50, 0x4b]),
      'bar.ann': 'other',
    });
    expect(dict.files).toEqual({
      dictionary: join(dir, 'foo.dsl'),
      abbreviations: join(dir, 'foo_abrv.dsl'),
      annotation: join(dir, 'foo.ann'),
      icon: join(dir, 'foo.bmp'),
      media: join(dir, 'foo.dsl.files.zip'),
    });
    expect([...(dict.abbreviations ?? [])]).toEqual([
      ['n', 'существительное'],
      ['n.', 'сущ.'],
    ]);
    expect(dict.annotation?.sections.map((s) => s.language?.name)).toEqual(['English', 'Russian']);
    expect(dict.annotation?.text).toBe('Synthetic dictionary.');
    expect(dict.diagnostics).toEqual([]);
  });

  it.each([
    ['foo_abrv.dsl'],
    ['foo_abrv.dsl.dz'],
    ['foo_ABRV.DSL'],
    ['foo_ABRV.DSL.DZ'],
    ['FOO_abrv.dsl'],
  ])('finds the abbreviations in %s', async (name) => {
    const { dir, dict } = await open({ 'foo.dsl': DICT, [name]: ABRV });
    expect(dict.files.abbreviations).toBe(join(dir, name));
    expect(dict.abbreviations?.get('n')).toBe('существительное');
  });

  it('finds companions of a .dsl.dz and of upper-case names', async () => {
    const { dir, dict } = await open(
      {
        'Foo.DSL.DZ': DICT,
        'Foo_ABRV.DSL.DZ': ABRV,
        'Foo.ANN': ANNOTATION,
        'Foo.BMP': new Uint8Array(2),
        'Foo.DSL.FILES.ZIP': new Uint8Array(2),
      },
      'Foo.DSL.DZ',
    );
    expect(Object.keys(dict.files)).toEqual([
      'dictionary',
      'abbreviations',
      'annotation',
      'icon',
      'media',
    ]);
    expect(dict.files.abbreviations).toBe(join(dir, 'Foo_ABRV.DSL.DZ'));
    expect(dict.abbreviations?.size).toBe(2);
    expect(dict.annotation?.sections).toHaveLength(2);
  });

  it('works for names with dots, spaces and non-ASCII letters', async () => {
    const name = 'Слово. v2 (en-ru)';
    const { dict } = await open(
      { [`${name}.dsl`]: DICT, [`${name}_abrv.dsl`]: ABRV, [`${name}.ann`]: 'x' },
      `${name}.dsl`,
    );
    expect(dict.abbreviations?.size).toBe(2);
    expect(dict.annotation?.text).toBe('x');
  });

  it('uses the base name of other extensions', async () => {
    const { dict } = await open(
      { 'foo.txt': DICT, 'foo.ann': 'a', 'foo_abrv.dsl': ABRV },
      'foo.txt',
    );
    expect(dict.files.annotation).toBeDefined();
    expect(dict.abbreviations?.size).toBe(2);
    const bare = await open({ foo: DICT, 'foo.ann': 'a' }, 'foo');
    expect(bare.dict.annotation?.text).toBe('a');
  });

  it('does not take the companions of another dictionary', async () => {
    const { dict } = await open({
      'foo.dsl': DICT,
      'foo2.ann': 'x',
      'foo-bar_abrv.dsl': ABRV,
      'foo.ann.txt': 'x',
    });
    expect(Object.keys(dict.files)).toEqual(['dictionary']);
  });

  it('does not take a directory for a companion', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT });
    mkdirSync(join(dir, 'foo.ann'));
    mkdirSync(join(dir, 'foo.bmp'));
    expect(Object.keys((await openDsl(join(dir, 'foo.dsl'))).files)).toEqual(['dictionary']);
  });

  it('finds a companion that is a symbolic link', async () => {
    const dir = tempDir();
    const other = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT });
    writeFiles(other, { 'real.ann': 'linked' });
    try {
      symlinkSync(join(other, 'real.ann'), join(dir, 'foo.ann'));
    } catch {
      return; // Symbolic links need privileges on some platforms.
    }
    expect((await openDsl(join(dir, 'foo.dsl'))).annotation?.text).toBe('linked');
  });

  it('reads annotations in any encoding, and an annotation without #LANGUAGE', async () => {
    const { dict } = await open({
      'foo.dsl': DICT,
      'foo.ann': encode('Привет\nмир', 'windows-1251'),
    });
    expect(dict.annotation).toEqual({ sections: [{ text: 'Привет\nмир' }], text: 'Привет\nмир' });
    const gz = await open({ 'foo.dsl': DICT, 'foo.ann': ANNOTATION });
    expect(gz.dict.annotation?.sections).toHaveLength(2);
  });
});

describe('companion options', () => {
  const files = {
    'foo.dsl': DICT,
    'foo_abrv.dsl': ABRV,
    'foo.ann': ANNOTATION,
    'foo.bmp': new Uint8Array(2),
    'foo.dsl.files.zip': new Uint8Array(2),
  };

  it('looks for nothing with companions: false', async () => {
    const { dict } = await open(files, 'foo.dsl', { companions: false });
    expect(Object.keys(dict.files)).toEqual(['dictionary']);
    expect(dict.abbreviations).toBeUndefined();
    expect(dict.annotation).toBeUndefined();
  });

  it('switches kinds off one by one', async () => {
    const dir = tempDir();
    writeFiles(dir, files);
    const path = join(dir, 'foo.dsl');
    const noAbrv = await openDsl(path, { companions: { abbreviations: false } });
    expect(Object.keys(noAbrv.files)).toEqual(['dictionary', 'annotation', 'icon', 'media']);
    expect(noAbrv.abbreviations).toBeUndefined();
    const noAnn = await openDsl(path, { companions: { annotation: false, icon: false } });
    expect(Object.keys(noAnn.files)).toEqual(['dictionary', 'abbreviations', 'media']);
    expect(noAnn.annotation).toBeUndefined();
    const noMedia = await openDsl(path, { companions: { media: false } });
    expect(Object.keys(noMedia.files)).toEqual([
      'dictionary',
      'abbreviations',
      'annotation',
      'icon',
    ]);
    expect(Object.keys((await openDsl(path, { companions: true })).files)).toHaveLength(5);
  });

  it('uses explicit paths instead of looking next to the dictionary', async () => {
    const dir = tempDir();
    const other = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT, 'foo.ann': 'next to it' });
    writeFiles(other, {
      'abbr.txt': ABRV,
      'about.txt': 'elsewhere',
      'pic.bmp': new Uint8Array(2),
      'media.zip': new Uint8Array(2),
    });
    const sink = createCollectingSink();
    const dict = await openDsl(join(dir, 'foo.dsl'), {
      diagnostics: sink,
      paths: {
        abbreviations: join(other, 'abbr.txt'),
        annotation: join(other, 'about.txt'),
        icon: join(other, 'pic.bmp'),
        media: join(other, 'media.zip'),
      },
    });
    expect(dict.files).toEqual({
      dictionary: join(dir, 'foo.dsl'),
      abbreviations: join(other, 'abbr.txt'),
      annotation: join(other, 'about.txt'),
      icon: join(other, 'pic.bmp'),
      media: join(other, 'media.zip'),
    });
    expect(dict.annotation?.text).toBe('elsewhere');
    expect(dict.abbreviations?.size).toBe(2);
    expect(sink.diagnostics).toEqual([]);
  });

  it('reports a missing explicit path (DSL6102) and does not fall back', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT, 'foo.ann': 'next to it' });
    const sink = createCollectingSink();
    const dict = await openDsl(join(dir, 'foo.dsl'), {
      diagnostics: sink,
      paths: { annotation: join(dir, 'nope.ann'), icon: dir },
    });
    expect(dict.annotation).toBeUndefined();
    expect(dict.files).toEqual({ dictionary: join(dir, 'foo.dsl') });
    expect(dict.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['DSL6102', 'warning'],
      ['DSL6102', 'warning'],
    ]);
    expect(sink.diagnostics).toEqual(dict.diagnostics);
  });

  it('ignores explicit paths of kinds that are switched off', async () => {
    const { dict } = await open({ 'foo.dsl': DICT }, 'foo.dsl', {
      companions: { annotation: false },
      paths: { annotation: 'nowhere.ann' },
    });
    expect(dict.diagnostics).toEqual([]);
  });

  it('takes abbreviations and annotation from the options without reading the files', async () => {
    const abbreviations = new Map([['n', 'noun']]);
    const { dict } = await open(files, 'foo.dsl', { abbreviations, annotation: 'Given' });
    expect(dict.abbreviations).toBe(abbreviations);
    expect(dict.annotation).toEqual({ sections: [{ text: 'Given' }], text: 'Given' });
    expect(Object.keys(dict.files)).toEqual(['dictionary', 'icon', 'media']);
    const out = await collect(dict.entries({ plugin: plainText, options: { expandLabels: true } }));
    expect(out[0]?.text).toBe('noun кошка');
  });
});

describe('missing and broken companions', () => {
  it('does not report missing companions', async () => {
    const sink = createCollectingSink();
    const { dict } = await open({ 'foo.dsl': DICT }, 'foo.dsl', { diagnostics: sink });
    expect(dict.diagnostics).toEqual([]);
    expect(sink.diagnostics).toEqual([]);
  });

  it('reports a broken gzip abbreviations file and goes on', async () => {
    const sink = createCollectingSink();
    const { dict } = await open(
      {
        'foo.dsl': DICT,
        'foo_abrv.dsl.dz': new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0, 1, 2]),
      },
      'foo.dsl',
      { diagnostics: sink },
    );
    expect(dict.diagnostics.map((d) => d.code)).toContain('DSL1101');
    expect(dict.abbreviations?.size).toBe(0);
    expect(sink.diagnostics).toEqual(dict.diagnostics);
    // The dictionary itself is fine.
    expect((await collect(dict.entries())).length).toBe(2);
  });

  it('reports a companion that cannot be read (DSL6101), also in strict mode', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT, 'foo.ann': 'secret', 'foo_abrv.dsl': ABRV });
    const file = join(dir, 'foo.ann');
    chmodSync(file, 0o000);
    try {
      if (isReadable(file)) return; // Running as root, or the platform ignores permissions.
      const dict = await openDsl(join(dir, 'foo.dsl'), { strict: true });
      expect(dict.annotation).toBeUndefined();
      expect(dict.abbreviations?.size).toBe(2);
      expect(dict.diagnostics).toHaveLength(1);
      expect(dict.diagnostics[0]).toMatchObject({ code: 'DSL6101', severity: 'warning' });
      expect(dict.diagnostics[0]?.cause).toBeDefined();
    } finally {
      chmodSync(file, 0o600);
    }
  });

  it('reports an invalid encoding for a companion only through the dictionary', async () => {
    // `encoding` is for the dictionary: a companion in another encoding is still detected.
    const { dict } = await open(
      { 'foo.dsl': encode(DICT, 'utf-8'), 'foo_abrv.dsl': ABRV },
      'foo.dsl',
      {
        encoding: 'utf-8',
      },
    );
    expect(dict.abbreviations?.size).toBe(2);
    expect(dict.diagnostics).toEqual([]);
  });

  it('reports a directory that cannot be listed', async () => {
    // Opening works on a file reached through a directory without read permission.
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT });
    chmodSync(dir, 0o300);
    try {
      if (isListable(dir)) return; // Running as root, or the platform ignores permissions.
      const dict = await openDsl(join(dir, 'foo.dsl'));
      expect(dict.diagnostics.map((d) => d.code)).toEqual(['DSL6101']);
      expect((await collect(dict.entries())).length).toBe(2);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('applies strict mode to the dictionary only', async () => {
    const dir = tempDir();
    const broken = (await gzip(encode(DICT, 'utf-8'))).subarray(0, 40);
    writeFiles(dir, { 'foo.dsl.dz': broken, 'foo.ann': ANNOTATION });
    const path = join(dir, 'foo.dsl.dz');
    const strict = await openDsl(path, { strict: true });
    expect(strict.annotation).toBeDefined();
    expect(await collect(strict.entries()).catch((e: unknown) => e)).toMatchObject({
      code: 'DSL1101',
    });
    const lenient = await openDsl(path);
    await collect(lenient.entries());
    expect(lenient.diagnostics.map((d) => d.code)).toContain('DSL1101');
  });

  it('keeps companion diagnostics first and those of the dictionary after', async () => {
    const { dict } = await open({
      'foo.dsl': '#NAME "x"\na\n\tb\n',
      'foo_abrv.dsl': `${ABRV}n\n\tagain\n`,
    });
    await collect(dict.entries());
    const codes = dict.diagnostics.map((d) => d.code);
    expect(codes[0]).toBe('DSL6001');
    expect(codes).toContain('DSL2001');
  });
});

describe('plugins through openDsl', () => {
  it('passes the companions to the plugin context', async () => {
    const dir = tempDir();
    writeFiles(dir, {
      'foo.dsl.dz': `${DICT}rat\n\t[p]adj.[/p] [p] n  [/p]\n`,
      'foo_abrv.dsl': ABRV,
      'foo.ann': ANNOTATION,
    });
    const dict = await openDsl(join(dir, 'foo.dsl.dz'));
    const out = await collect(dict.entries({ plugin: plainText, options: { expandLabels: true } }));
    expect(out.map((o) => o.text)).toEqual([
      'существительное кошка',
      'сущ. собака',
      'adj. существительное',
    ]);
    const seen: unknown[] = [];
    const probe = {
      name: 'probe',
      version: '1.0.0',
      setup: (context: { annotation?: unknown; abbreviations?: unknown }) => {
        seen.push(context);
        return () => 1;
      },
    };
    const again = await openDsl(join(dir, 'foo.dsl.dz'));
    await collect(again.batches({ plugin: probe }));
    expect(seen).toEqual([
      expect.objectContaining({ annotation: again.annotation, abbreviations: again.abbreviations }),
    ]);
  });

  it('works with batches and the search-text plugin', async () => {
    const { dict } = await open({ 'foo.dsl': DICT });
    const batches = await collect(dict.batches({ plugin: searchText }));
    expect(batches.flat().map((o) => o.headwords)).toEqual([['cat'], ['dog']]);
  });

  it('rejects a plugin with raw bodies, like parseDsl', async () => {
    const { dict } = await open({ 'foo.dsl': DICT }, 'foo.dsl', { body: 'raw' });
    expect(() =>
      (dict as never as { entries(u: unknown): unknown }).entries({ plugin: plainText }),
    ).toThrow(expect.objectContaining({ code: 'DSL0001' }));
  });

  it('reads an entries stream once', async () => {
    const { dict } = await open({ 'foo.dsl': DICT });
    await collect(dict.entries());
    expect(() => dict.entries()).toThrow(expect.objectContaining({ code: 'DSL0002' }));
  });

  it('gives the same map as parseAbbreviations', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'foo.dsl': DICT, 'foo_abrv.dsl': ABRV });
    const dict = await openDsl(join(dir, 'foo.dsl'));
    expect(dict.abbreviations).toEqual(await parseAbbreviations(encode(ABRV, 'utf-16le', true)));
  });
});

function isReadable(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function isListable(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}
