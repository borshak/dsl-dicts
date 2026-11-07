import { describe, expect, it } from 'vitest';
import { dictionaryBaseName } from '../../src/node/index.js';
import { findCompanion, isAbbreviationsName, isDictionaryName } from '../../src/node/names.js';

describe('dictionaryBaseName', () => {
  it('strips .dsl, .dsl.dz and .dsl.gz in any case', () => {
    expect(dictionaryBaseName('foo.dsl')).toBe('foo');
    expect(dictionaryBaseName('foo.dsl.dz')).toBe('foo');
    expect(dictionaryBaseName('foo.dsl.gz')).toBe('foo');
    expect(dictionaryBaseName('FOO.DSL')).toBe('FOO');
    expect(dictionaryBaseName('Foo Bar.Dsl.Dz')).toBe('Foo Bar');
    expect(dictionaryBaseName('a.b.dsl')).toBe('a.b');
  });

  it('ignores directories, whatever the separator of the platform', () => {
    expect(dictionaryBaseName('/dicts/en-ru.dsl.dz')).toBe('en-ru');
    expect(dictionaryBaseName('dicts/sub.dir/en-ru.dsl')).toBe('en-ru');
  });

  it('strips the last extension of other names, and nothing else', () => {
    expect(dictionaryBaseName('foo.txt')).toBe('foo');
    expect(dictionaryBaseName('foo.bar.txt')).toBe('foo.bar');
    expect(dictionaryBaseName('foo')).toBe('foo');
    expect(dictionaryBaseName('.hidden')).toBe('.hidden');
    expect(dictionaryBaseName('.dsl')).toBe('.dsl');
  });
});

describe('name classification', () => {
  it('recognizes dictionary and abbreviations files', () => {
    expect(['a.dsl', 'a.DSL.DZ', 'a.dsl.gz', 'a_abrv.dsl'].map(isDictionaryName)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['a.ann', 'a.bmp', 'a.dsl.files.zip', '.dsl', 'dsl'].map(isDictionaryName)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(['a_abrv.dsl', 'a_ABRV.DSL.DZ', 'a_Abrv.dsl'].every(isAbbreviationsName)).toBe(true);
    expect(isAbbreviationsName('a.dsl')).toBe(false);
  });
});

describe('findCompanion', () => {
  const find = (names: string[], kind: Parameters<typeof findCompanion>[2], base = 'foo') =>
    findCompanion(names, base, kind);

  it('finds every kind', () => {
    const names = ['foo.dsl', 'foo.ann', 'foo.bmp', 'foo.dsl.files.zip', 'foo_abrv.dsl', 'bar.ann'];
    expect(find(names, 'abbreviations')).toBe('foo_abrv.dsl');
    expect(find(names, 'annotation')).toBe('foo.ann');
    expect(find(names, 'icon')).toBe('foo.bmp');
    expect(find(names, 'media')).toBe('foo.dsl.files.zip');
    expect(find(['foo.dsl'], 'annotation')).toBeUndefined();
    expect(find(['foobar.ann', 'xfoo.ann', 'foo.ann.bak'], 'annotation')).toBeUndefined();
  });

  it('matches in any letter case', () => {
    for (const name of ['foo_abrv.dsl', 'foo_abrv.dsl.dz', 'foo_ABRV.DSL', 'foo_ABRV.DSL.DZ']) {
      expect(find([name], 'abbreviations')).toBe(name);
    }
    expect(find(['FOO_Abrv.Dsl'], 'abbreviations')).toBe('FOO_Abrv.Dsl');
    expect(find(['Foo.ANN'], 'annotation')).toBe('Foo.ANN');
    expect(find(['FOO.BMP'], 'icon')).toBe('FOO.BMP');
    expect(find(['Foo.DSL.Files.ZIP'], 'media')).toBe('Foo.DSL.Files.ZIP');
  });

  it('prefers uncompressed, then lower case, then upper case, then the name', () => {
    expect(find(['foo_abrv.dsl.dz', 'foo_abrv.dsl'], 'abbreviations')).toBe('foo_abrv.dsl');
    expect(find(['foo_ABRV.DSL', 'foo_abrv.dsl.dz'], 'abbreviations')).toBe('foo_ABRV.DSL');
    expect(find(['foo_ABRV.DSL', 'foo_abrv.dsl'], 'abbreviations')).toBe('foo_abrv.dsl');
    expect(find(['foo_Abrv.dsl', 'foo_ABRV.DSL'], 'abbreviations')).toBe('foo_ABRV.DSL');
    expect(find(['foo_Abrv.dsl', 'foo_aBRv.dsl'], 'abbreviations')).toBe('foo_Abrv.dsl');
    expect(find(['foo.Ann', 'foo.ANN'], 'annotation')).toBe('foo.ANN');
  });

  it('matches names whatever their Unicode normalization', () => {
    const nfd = 'Café'.normalize('NFD');
    expect(find([`${nfd}.ann`], 'annotation', 'Café')).toBe(`${nfd}.ann`);
    expect(find(['Café.ann'], 'annotation', nfd)).toBe('Café.ann');
  });
});
