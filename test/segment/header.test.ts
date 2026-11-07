import { describe, expect, it } from 'vitest';
import { findLanguageByName } from '../../src/index.js';
import { HEADER, segment, segmentAsync } from './helpers.js';

describe('header', () => {
  it('parses the mandatory directives', () => {
    const { header, codes } = segment(`${HEADER}a\n\tb\n`);
    expect(header).toEqual({
      directives: [
        {
          name: 'NAME',
          raw: '"Test"',
          value: 'Test',
          position: { offset: 0, line: 1, column: 1 },
        },
        {
          name: 'INDEX_LANGUAGE',
          raw: '"English"',
          value: 'English',
          position: { offset: 13, line: 2, column: 1 },
        },
        {
          name: 'CONTENTS_LANGUAGE',
          raw: '"Russian"',
          value: 'Russian',
          position: { offset: 39, line: 3, column: 1 },
        },
      ],
      name: 'Test',
      indexLanguage: 'English',
      contentsLanguage: 'Russian',
      indexLanguageInfo: findLanguageByName('English'),
      contentsLanguageInfo: findLanguageByName('Russian'),
    });
    expect(codes).toEqual([]);
  });

  it('keeps unknown and optional directives in order, as is', () => {
    const text = `#ICON_FILE "a.bmp"\n\n${HEADER}#SOUND_DICTIONARY "snd"\n#SOURCE_CODE_PAGE "Cyrillic"\n#FOO\t "bar baz" \na\n\tb\n`;
    const { header, diagnostics } = segment(text);
    expect(header?.directives.map((d) => [d.name, d.value])).toEqual([
      ['ICON_FILE', 'a.bmp'],
      ['NAME', 'Test'],
      ['INDEX_LANGUAGE', 'English'],
      ['CONTENTS_LANGUAGE', 'Russian'],
      ['SOUND_DICTIONARY', 'snd'],
      ['SOURCE_CODE_PAGE', 'Cyrillic'],
      ['FOO', 'bar baz'],
    ]);
    expect(header?.directives.at(-1)?.raw).toBe('"bar baz"');
    expect(diagnostics).toMatchObject([
      { code: 'DSL2004', severity: 'info', position: { line: 8 } },
    ]);
  });

  it('takes the value between the first and the last quote', () => {
    const { header, codes } = segment('#NAME "a "quoted" name" junk\n#NAME2"x"\n');
    expect(header?.directives.map((d) => [d.name, d.value])).toEqual([
      ['NAME', 'a "quoted" name'],
      ['NAME2', 'x'],
    ]);
    expect(codes).not.toContain('DSL2002');
  });

  it('reports unquoted values and nameless directives', () => {
    const { header, diagnostics } = segment(`#NAME My dict \n#\n# x\n${HEADER.slice(13)}a\n\tb\n`);
    expect(header?.name).toBe('My dict');
    expect(header?.directives.map((d) => [d.name, d.value])).toEqual([
      ['NAME', 'My dict'],
      ['', ''],
      ['', 'x'],
      ['INDEX_LANGUAGE', 'English'],
      ['CONTENTS_LANGUAGE', 'Russian'],
    ]);
    expect(diagnostics.map((d) => [d.code, d.position?.line])).toEqual([
      ['DSL2002', 1],
      ['DSL2002', 2],
      ['DSL2002', 3],
    ]);
  });

  it('reports missing mandatory directives without throwing', () => {
    const { header, diagnostics } = segment('#NAME "x"\na\n\tb\n');
    expect(header).toEqual({ directives: [expect.anything()], name: 'x' });
    expect(diagnostics).toMatchObject([
      { code: 'DSL2001', severity: 'warning', message: expect.stringContaining('INDEX_LANGUAGE') },
      { code: 'DSL2001', message: expect.stringContaining('CONTENTS_LANGUAGE') },
    ]);
  });

  it('uses the first of repeated directives, case-insensitively', () => {
    const { header, codes } = segment(`${HEADER}#name "Second"\na\n\tb\n`);
    expect(header?.name).toBe('Test');
    expect(header?.directives).toHaveLength(4);
    expect(codes).toEqual(['DSL2003']);
  });

  it('reports unknown languages, and inexact names as info', () => {
    const { header, diagnostics } = segment(
      '#NAME "x"\n#INDEX_LANGUAGE "Klingon"\n#CONTENTS_LANGUAGE "russian"\n',
    );
    expect(header).toMatchObject({ indexLanguage: 'Klingon', contentsLanguage: 'russian' });
    expect(header?.indexLanguageInfo).toBeUndefined();
    expect(header?.contentsLanguageInfo?.name).toBe('Russian');
    expect(diagnostics.map((d) => [d.code, d.severity, d.position?.line])).toEqual([
      ['DSL2005', 'warning', 2],
      ['DSL2007', 'info', 3],
    ]);
    expect(diagnostics[1]?.message).toContain('read as Russian');
  });

  it('resolves names without their ending, as GoldenDict does', () => {
    const { header, diagnostics } = segment(
      '#NAME "x"\n#INDEX_LANGUAGE "Spanish"\n#CONTENTS_LANGUAGE "GermanNewSpelling"\n',
    );
    expect(header?.indexLanguage).toBe('Spanish');
    expect(header?.indexLanguageInfo?.name).toBe('SpanishModernSort');
    expect(header?.contentsLanguageInfo?.name).toBe('GermanNewSpelling');
    expect(diagnostics.map((d) => d.code)).toEqual(['DSL2007']);
    expect(diagnostics[0]?.message).toContain('SpanishModernSort');
  });

  it('removes comments from directive lines and drops comment-only lines', () => {
    const text = `{{ header\ncomment }}\n#NAME "a{{x}}b" {{ trailing }}\n${HEADER.slice(13)}`;
    const { header, codes } = segment(text);
    expect(header?.name).toBe('ab');
    expect(header?.directives[0]?.raw).toBe('"ab"');
    expect(header?.directives[0]?.position).toMatchObject({ line: 3, column: 1 });
    expect(codes).toEqual([]);
  });

  it('is complete at the end of input when there are no entries', async () => {
    const { header, entries } = await segmentAsync(HEADER);
    expect(header?.name).toBe('Test');
    expect(entries).toEqual([]);
  });

  it('is available from the synchronous segmenter once the preamble is over', () => {
    const { header } = segment(`${HEADER}a`, 1);
    expect(header?.directives).toHaveLength(3);
  });
});
