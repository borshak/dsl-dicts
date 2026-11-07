import { describe, expect, it } from 'vitest';
import { article } from '../../src/article/index.js';
import {
  AST_VERSION,
  createDiagnosticTally,
  createJsonlHeader,
  type JsonlHeaderRecord,
  parseDsl,
  parseJsonlHeader,
  readJsonl,
  toJsonl,
} from '../../src/index.js';
import { collect, dictOf, NOISY, TEXT } from './helpers.js';

const HEADER: JsonlHeaderRecord = {
  type: 'header',
  format: 'dsl-dicts/jsonl',
  formatVersion: 1,
  generator: { name: 'dsl-dicts', version: '2.0.0' },
  astVersion: 1,
  plugin: { name: 'article', version: '1.2.0' },
  dictionary: { name: 'n', indexLanguage: 'English', contentsLanguage: 'Russian' },
  decode: { encoding: 'utf-16le', source: 'bom', compression: 'none' },
};

const line = (value: unknown) => JSON.stringify(value);
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};
const asyncCodeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: { code?: string }) => error.code,
  );

describe('createJsonlHeader', () => {
  it('uses null for missing directives and records the decoding', async () => {
    const dict = parseDsl('a\n\tb\n');
    const header = createJsonlHeader({ header: await dict.header, info: await dict.info });
    expect(header.dictionary).toEqual({ name: null, indexLanguage: null, contentsLanguage: null });
    expect(header.plugin).toBeNull();
    expect(header.decode.compression).toBe('none');
  });

  it('writes a header that its own parser accepts', async () => {
    const dict = dictOf(TEXT);
    const made = createJsonlHeader({
      header: await dict.header,
      info: await dict.info,
      plugin: article,
    });
    expect(parseJsonlHeader(line(made))).toEqual(made);
    expect(made.plugin).toEqual({ name: 'article', version: article.version });
  });
});

describe('parseJsonlHeader', () => {
  it('returns a valid header, ignoring fields it does not know', () => {
    expect(parseJsonlHeader(line(HEADER))).toEqual(HEADER);
    const extended = { ...HEADER, future: { a: 1 }, decode: { ...HEADER.decode, more: 1 } };
    expect(parseJsonlHeader(line(extended))).toEqual(extended);
  });

  it('refuses what is not a dsl-dicts header (DSL7001)', () => {
    const bad = [
      '',
      'not json',
      '[1]',
      '"header"',
      'null',
      line({ ...HEADER, type: 'entry' }),
      line({ ...HEADER, type: undefined }),
      line({ ...HEADER, format: 'other/jsonl' }),
      line({ ...HEADER, format: undefined }),
      line({ ...HEADER, formatVersion: 0 }),
      line({ ...HEADER, formatVersion: 1.5 }),
      line({ ...HEADER, formatVersion: '1' }),
      line({ ...HEADER, generator: null }),
      line({ ...HEADER, astVersion: 'x' }),
      line({ ...HEADER, plugin: 'article' }),
      line({ ...HEADER, plugin: { name: 'a', version: 'nope' } }),
      line({ ...HEADER, dictionary: null }),
      line({ ...HEADER, decode: [] }),
    ];
    for (const text of bad)
      expect(
        codeOf(() => parseJsonlHeader(text)),
        text,
      ).toBe('DSL7001');
  });

  it('refuses another major version of the format (DSL7002), before reading the rest', () => {
    for (const formatVersion of [2, 3, 100]) {
      expect(codeOf(() => parseJsonlHeader(line({ ...HEADER, formatVersion })))).toBe('DSL7002');
    }
    // A future header may be shaped differently: only its format and version are looked at.
    const future = line({ type: 'header', format: 'dsl-dicts/jsonl', formatVersion: 2 });
    expect(codeOf(() => parseJsonlHeader(future))).toBe('DSL7002');
    expect(codeOf(() => parseJsonlHeader(future, { astVersion: 1 }))).toBe('DSL7002');
  });

  it('checks the AST version when asked (DSL7003)', () => {
    expect(parseJsonlHeader(line(HEADER), { astVersion: 1 })).toEqual(HEADER);
    expect(codeOf(() => parseJsonlHeader(line(HEADER), { astVersion: 2 }))).toBe('DSL7003');
    expect(
      codeOf(() =>
        parseJsonlHeader(line({ ...HEADER, astVersion: 2 }), { astVersion: AST_VERSION }),
      ),
    ).toBe('DSL7003');
  });

  it('checks the plugin by name and major version when asked (DSL7004)', () => {
    const plugin = (expected: { name: string; version?: string } | null, header = HEADER) =>
      codeOf(() => parseJsonlHeader(line(header), { plugin: expected }));
    expect(plugin({ name: 'article' })).toBeUndefined();
    expect(plugin({ name: 'article', version: '1.0.0' })).toBeUndefined(); // minor differs: fine
    expect(plugin({ name: 'article', version: '1.9.9' })).toBeUndefined();
    expect(plugin({ name: 'article', version: '2.0.0' })).toBe('DSL7004');
    expect(plugin({ name: 'article', version: '0.1.0' })).toBe('DSL7004');
    expect(plugin({ name: 'plain-text' })).toBe('DSL7004');
    expect(plugin(null)).toBe('DSL7004');
    expect(plugin({ name: 'article' }, { ...HEADER, plugin: null })).toBe('DSL7004');
    expect(plugin(null, { ...HEADER, plugin: null })).toBeUndefined();
    expect(plugin({ name: 'article', version: 'x' })).toBe('DSL0001');
  });

  it('rejects invalid expectations', () => {
    expect(codeOf(() => parseJsonlHeader(line(HEADER), null as never))).toBe('DSL0001');
  });
});

describe('readJsonl', () => {
  const make = async (options = {}) =>
    (await collect(toJsonl(dictOf(NOISY), { summary: true, ...options }))).join('');

  it('reads what toJsonl writes: the header, the entries, the summary', async () => {
    const text = await make();
    const reader = await readJsonl([text]);
    expect(reader.header.dictionary.name).toBe('Test');
    const records = await collect(reader.records);
    expect(records.map((r) => r.type)).toEqual(['entry', 'entry', 'entry', 'summary']);
    const expected = await collect(parseDsl(NOISY).entries());
    expect(records.slice(0, 3).map((r) => r.type === 'entry' && r.data)).toEqual(
      JSON.parse(JSON.stringify(expected)),
    );
  });

  it('reads the same records however the text is cut', async () => {
    const text = await make();
    const whole = await collect((await readJsonl([text])).records);
    for (const size of [1, 2, 7, 50, 1000]) {
      const chunks = Array.from({ length: Math.ceil(text.length / size) }, (_, i) =>
        text.slice(i * size, (i + 1) * size),
      );
      async function* stream() {
        yield* chunks;
      }
      expect(await collect((await readJsonl(stream())).records), `size ${size}`).toEqual(whole);
    }
  });

  it('accepts the lines as written, with CRLF, blank lines, and no final newline', async () => {
    const lines = (await make()).split('\n').filter(Boolean);
    const messy = `\n${lines.join('\r\n\r\n')}`;
    const reader = await readJsonl([messy]);
    expect(await collect(reader.records)).toHaveLength(4);
    expect(await collect((await readJsonl(lines.map((l) => `${l}\n`))).records)).toHaveLength(4);
  });

  it('checks the expectations with the header', async () => {
    const lines = await collect(toJsonl(dictOf(TEXT), { plugin: article }));
    const expect_ = {
      astVersion: AST_VERSION,
      plugin: { name: 'article', version: article.version },
    };
    expect((await readJsonl(lines, expect_)).header.plugin?.name).toBe('article');
    expect(await asyncCodeOf(readJsonl(lines, { astVersion: AST_VERSION + 1 }))).toBe('DSL7003');
    expect(await asyncCodeOf(readJsonl(lines, { plugin: null }))).toBe('DSL7004');
    expect(await asyncCodeOf(readJsonl(lines, { plugin: { name: 'plain-text' } }))).toBe('DSL7004');
    expect(
      await asyncCodeOf(readJsonl(lines, { plugin: { name: 'article', version: '99.0.0' } })),
    ).toBe('DSL7004');
  });

  it('refuses an empty document and other formats before any record (DSL7001, DSL7002)', async () => {
    expect(await asyncCodeOf(readJsonl([]))).toBe('DSL7001');
    expect(await asyncCodeOf(readJsonl(['\n  \n']))).toBe('DSL7001');
    expect(await asyncCodeOf(readJsonl(['{"a":1}\n']))).toBe('DSL7001');
    expect(await asyncCodeOf(readJsonl([`${line({ ...HEADER, formatVersion: 2 })}\n`]))).toBe(
      'DSL7002',
    );
    expect(await asyncCodeOf(readJsonl(['{"type":"entry","data":1}\n']))).toBe('DSL7001');
  });

  it('refuses a malformed record while iterating (DSL7005)', async () => {
    const head = `${line(HEADER)}\n`;
    const bad = [
      'oops',
      '[1]',
      '{"data":1}',
      '{"type":5}',
      '{"type":"entry"}',
      '{"type":"summary","entries":"x","diagnostics":{}}',
      '{"type":"summary","entries":1}',
      line(HEADER),
    ];
    for (const record of bad) {
      const reader = await readJsonl([`${head}{"type":"entry","data":null}\n${record}\n`]);
      expect(await asyncCodeOf(collect(reader.records)), record).toBe('DSL7005');
    }
  });

  it('skips records of types it does not know', async () => {
    const reader = await readJsonl([
      `${line(HEADER)}\n{"type":"future","x":1}\n{"type":"entry","data":"a"}\n`,
    ]);
    expect(await collect(reader.records)).toEqual([{ type: 'entry', data: 'a' }]);
  });

  it('names the line of a bad record', async () => {
    const reader = await readJsonl([`${line(HEADER)}\n\n{"type":"entry","data":1}\noops\n`]);
    const error = await collect(reader.records).catch((e: Error) => e);
    expect((error as Error).message).toContain('Line 4');
  });

  it('stops reading the input when the records are abandoned', async () => {
    let pulled = 0;
    async function* source() {
      yield `${line(HEADER)}\n`;
      for (let i = 0; i < 1000; i++) {
        pulled++;
        yield `{"type":"entry","data":${i}}\n`;
      }
    }
    const reader = await readJsonl(source());
    for await (const _ of reader.records) break;
    expect(pulled).toBe(1);
  });

  it('refuses text that is not strings', async () => {
    expect(await asyncCodeOf(readJsonl([1 as never]))).toBe('DSL0001');
  });

  it('reads a document with a tally summary back', async () => {
    const tally = createDiagnosticTally();
    const dict = parseDsl(NOISY, { diagnostics: tally });
    const lines = await collect(toJsonl(dict, { summary: true, tally }));
    const records = await collect((await readJsonl(lines)).records);
    expect(records.at(-1)).toEqual({
      type: 'summary',
      entries: 3,
      diagnostics: { DSL4101: 1, DSL4202: 1 },
    });
  });
});
