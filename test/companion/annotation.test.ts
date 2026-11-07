import { describe, expect, it } from 'vitest';
import {
  createCollectingSink,
  createDictionaryContext,
  parseAnnotation,
  parseDsl,
} from '../../src/index.js';
import { catchError, dictzip, encode, gzip, split, streamOf } from '../decode/helpers.js';
import { collect, thrown } from '../plugin/helpers.js';

const SINGLE = '\n  First line.\n\n  Third line (café).\n\n';
const SECTIONS =
  'Preamble.\n' +
  '#LANGUAGE "English"\nEnglish text.\nMore.\n\n' +
  '#LANGUAGE "Russian"\n\nТекст по-русски.\n' +
  '#LANGUAGE "Klingon"\nqapla\'\n';

describe('parseAnnotation', () => {
  it('makes one section of a file without #LANGUAGE, keeping its formatting', async () => {
    const annotation = await parseAnnotation(SINGLE);
    expect(annotation).toEqual({
      sections: [{ text: '  First line.\n\n  Third line (café).' }],
      text: '  First line.\n\n  Third line (café).',
    });
  });

  it('splits sections by #LANGUAGE and resolves the languages', async () => {
    const sink = createCollectingSink();
    const { sections, text } = await parseAnnotation(SECTIONS, { diagnostics: sink });
    expect(sections.map((s) => [s.name, s.language?.name, s.text])).toEqual([
      [undefined, undefined, 'Preamble.'],
      ['English', 'English', 'English text.\nMore.'],
      ['Russian', 'Russian', 'Текст по-русски.'],
      ['Klingon', undefined, "qapla'"],
    ]);
    expect(text).toBe('Preamble.');
    expect(sink.diagnostics.map((d) => [d.code, d.position?.line])).toEqual([['DSL2005', 9]]);
  });

  it('reads names leniently and reports inexact ones', async () => {
    const sink = createCollectingSink();
    const { sections, text } = await parseAnnotation(
      '#language "spanish"\nHola\n#LANGUAGE Foo\nx',
      {
        diagnostics: sink,
      },
    );
    expect(sections[0]).toMatchObject({ name: 'spanish', language: { name: 'SpanishModernSort' } });
    expect(sections[1]).toMatchObject({ name: 'Foo', text: 'x' });
    expect(text).toBe('Hola');
    expect(sink.diagnostics.map((d) => d.code)).toEqual(['DSL2007', 'DSL2002', 'DSL2005']);
  });

  it('does not take #LANGUAGEX or an indented line for a section', async () => {
    const { sections } = await parseAnnotation('#LANGUAGEX "a"\n #LANGUAGE "b"\nz');
    expect(sections).toEqual([{ text: '#LANGUAGEX "a"\n #LANGUAGE "b"\nz' }]);
  });

  it('keeps a section that is only named, and drops a blank preamble', async () => {
    const { sections, text } = await parseAnnotation(
      '\n\n#LANGUAGE "English"\n\n#LANGUAGE "German"\nHallo',
    );
    expect(sections.map((s) => [s.name, s.text])).toEqual([
      ['English', ''],
      ['German', 'Hallo'],
    ]);
    expect(text).toBe('');
  });

  it('is empty for an empty file', async () => {
    expect(await parseAnnotation('')).toEqual({ sections: [], text: '' });
    expect(await parseAnnotation(new Uint8Array(0))).toEqual({ sections: [], text: '' });
    expect(await parseAnnotation('\n \n')).toEqual({ sections: [], text: '' });
  });

  it('decodes UTF-16LE with a BOM, UTF-8, 8-bit, gzip and dictzip alike', async () => {
    const expected = await parseAnnotation(SECTIONS);
    const utf16 = encode(SECTIONS.replace('\n', '\r\n'), 'utf-16le', true);
    for (const source of [
      utf16,
      split(utf16, 3),
      streamOf(split(utf16, 7)),
      new Blob([utf16.slice()]),
      encode(SECTIONS, 'utf-8', true),
      await gzip(utf16),
      await dictzip(encode(SECTIONS, 'utf-8'), { chunkLength: 64 }),
    ]) {
      expect(await parseAnnotation(source)).toEqual(expected);
    }
    const cp1251 = encode('#LANGUAGE "Russian"\nПривет', 'windows-1251');
    expect((await parseAnnotation(cp1251)).text).toBe('Привет');
    expect((await parseAnnotation(cp1251, { defaultEncoding: 'cp1252' })).text).not.toBe('Привет');
  });

  it('rejects invalid arguments', async () => {
    expect(await catchError(() => parseAnnotation(1 as never))).toMatchObject({ code: 'DSL0001' });
    expect(await catchError(() => parseAnnotation('', { encoding: 'nope' }))).toMatchObject({
      code: 'DSL1002',
    });
  });
});

describe('annotation in the plugin context', () => {
  it('is an Annotation; a string becomes one section', () => {
    const parsed = { sections: [{ name: 'English', text: 'Hi' }], text: 'Hi' };
    expect(createDictionaryContext({ annotation: parsed }).annotation).toBe(parsed);
    expect(createDictionaryContext({ annotation: 'About' }).annotation).toEqual({
      sections: [{ text: 'About' }],
      text: 'About',
    });
    expect(createDictionaryContext({ annotation: '' }).annotation).toEqual({
      sections: [],
      text: '',
    });
    expect(createDictionaryContext({}).annotation).toBeUndefined();
    for (const annotation of [1, null, {}, { text: 'x' }, { sections: [{}], text: 'x' }]) {
      expect(
        thrown(() => createDictionaryContext({ annotation: annotation as never })),
      ).toMatchObject({
        code: 'DSL0001',
      });
    }
  });

  it('reaches the plugin from parseDsl', async () => {
    const annotation = await parseAnnotation(SECTIONS);
    const seen: unknown[] = [];
    const plugin = {
      name: 'probe',
      version: '1.0.0',
      setup: (context: { annotation?: unknown }) => {
        seen.push(context.annotation);
        return () => 0;
      },
    };
    await collect(parseDsl('#NAME "x"\na\n\tb\n', { annotation }).entries({ plugin }));
    expect(seen).toEqual([annotation]);
  });
});
