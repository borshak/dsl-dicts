import { describe, expect, it } from 'vitest';
import { article } from '../../src/article/index.js';
import {
  AST_VERSION,
  createCollectingSink,
  createPluginDiagnostic,
  type DslEntry,
  type DslPlugin,
  definePlugin,
  JSONL_FORMAT,
  JSONL_FORMAT_VERSION,
  parseDsl,
  toJson,
  toJsonl,
  VERSION,
} from '../../src/index.js';
import { plainText } from '../../src/plugins/index.js';
import { collect, countingSource, dictOf, NOISY, TEXT } from './helpers.js';

const records = (lines: readonly string[]) => lines.map((line) => JSON.parse(line));

describe('toJsonl', () => {
  it('writes a header, then one entry record per entry, one compact line each', async () => {
    const lines = await collect(toJsonl(dictOf(TEXT)));
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.slice(0, -1)).not.toMatch(/\n/);
    }
    const [header, cat, dog] = records(lines);
    expect(header).toEqual({
      type: 'header',
      format: JSONL_FORMAT,
      formatVersion: JSONL_FORMAT_VERSION,
      generator: { name: 'dsl-dicts', version: VERSION },
      astVersion: AST_VERSION,
      plugin: null,
      dictionary: { name: 'Test', indexLanguage: 'English', contentsLanguage: 'Russian' },
      decode: { encoding: 'utf-16', source: 'string', compression: 'none' },
    });
    expect(Object.keys(cat)).toEqual(['type', 'data']);
    expect(cat.type).toBe('entry');
    expect(cat.data.headwords[0].text).toBe('cat');
    expect(cat.data.position).toEqual({ offset: expect.any(Number), line: 4, column: 1 });
    expect(dog.data.headwords[0].text).toBe('dog');
  });

  it('exports the AST entries as parsed, positions included', async () => {
    const expected = await collect(parseDsl(TEXT).entries());
    const lines = await collect(toJsonl(dictOf(TEXT)));
    expect(records(lines.slice(1)).map((r) => r.data)).toEqual(
      JSON.parse(JSON.stringify(expected)),
    );
  });

  it('records the plugin in the header and its output in data', async () => {
    const lines = await collect(toJsonl(dictOf(TEXT), { plugin: plainText }));
    const [header, cat] = records(lines);
    expect(header.plugin).toEqual({ name: 'plain-text', version: plainText.version });
    expect(header.astVersion).toBe(AST_VERSION);
    expect(cat).toEqual({ type: 'entry', data: { headwords: ['cat'], text: 'n кошка' } });
  });

  it('passes the options to the plugin', async () => {
    const options = { subentries: false };
    const lines = await collect(toJsonl(dictOf(TEXT), { plugin: plainText, options }));
    expect(records(lines)).toHaveLength(3);
    const bad = toJsonl(dictOf(TEXT), { plugin: plainText, options: { bogus: 1 } as never });
    expect(await collect(bad).catch((e: unknown) => e)).toMatchObject({
      code: 'DSL0001',
      plugin: 'plain-text',
    });
  });

  it('exports the output of the article plugin', async () => {
    const lines = await collect(toJsonl(dictOf(TEXT), { plugin: article }));
    expect(records(lines)[0].plugin).toEqual({ name: 'article', version: article.version });
    expect(records(lines)[1].data.headwords).toBeDefined();
  });

  it('keeps plugin output out of the envelope: no collisions, any JSON value', async () => {
    const odd: DslPlugin<unknown> = definePlugin({
      name: 'odd',
      version: '1.2.3',
      setup: () => {
        let n = 0;
        return () => [{ type: 'header', format: 'x' }, 'text', 42, null][n++ % 4];
      },
    });
    const lines = await collect(toJsonl(dictOf(TEXT), { plugin: odd }));
    expect(records(lines.slice(1))).toEqual([
      { type: 'entry', data: { type: 'header', format: 'x' } },
      { type: 'entry', data: 'text' },
    ]);
  });

  it('ends with a summary of the entries and the diagnostics by code', async () => {
    const lines = await collect(toJsonl(dictOf(NOISY), { summary: true }));
    const summary = records(lines).at(-1);
    expect(summary).toEqual({
      type: 'summary',
      entries: 3,
      diagnostics: { DSL4101: 1, DSL4202: 1 },
    });
    expect(Object.keys(summary.diagnostics)).toEqual(['DSL4101', 'DSL4202']);
  });

  it('counts the diagnostics of the header and decoding in the summary', async () => {
    const dict = parseDsl('a\n\tb\n');
    const summary = records(await collect(toJsonl(dict, { summary: true }))).at(-1);
    expect(summary.diagnostics).toEqual({ DSL2001: 3 });
  });

  it('counts every diagnostic with a plugin too, those the plugin reports included', async () => {
    const sink = createCollectingSink();
    const dict = parseDsl(NOISY, { diagnostics: sink });
    const summary = records(await collect(toJsonl(dict, { plugin: plainText, summary: true }))).at(
      -1,
    );
    expect(summary).toEqual({
      type: 'summary',
      entries: 3,
      diagnostics: { DSL4101: 1, DSL4202: 1 },
    });
    expect(sink.diagnostics).toHaveLength(2);
    const reporting = definePlugin({
      name: 'reporting',
      version: '1.0.0',
      setup: (context) => (entry) => {
        context.diagnostics.report(
          createPluginDiagnostic('reporting', 'seen', { code: 'reporting/seen' }),
        );
        return entry.headwords.length;
      },
    });
    const counted = records(
      await collect(toJsonl(dictOf(NOISY), { plugin: reporting, summary: true })),
    ).at(-1);
    expect(counted.diagnostics).toEqual({ DSL4101: 1, DSL4202: 1, 'reporting/seen': 3 });
  });

  it('refuses a dictionary with raw bodies', () => {
    const raw = parseDsl(TEXT, { body: 'raw' });
    for (const call of [() => toJsonl(raw as never), () => toJson(raw as never)]) {
      expect(call).toThrow(expect.objectContaining({ code: 'DSL0001' }));
    }
  });

  it('has no summary unless requested, and an empty dictionary has only a header', async () => {
    expect(await collect(toJsonl(dictOf(TEXT)))).toHaveLength(3);
    const lines = await collect(toJsonl(dictOf(HEADER_ONLY), { summary: true }));
    expect(records(lines).map((r) => r.type)).toEqual(['header', 'summary']);
    expect(records(lines)[1].entries).toBe(0);
  });

  it('streams: the first lines are written before the input is read to the end', async () => {
    const text = TEXT + Array.from({ length: 3000 }, (_, i) => `w${i}\n\tx${i}\n`).join('');
    const { source, read, total } = countingSource(text, 256);
    const iterator = toJsonl(parseDsl(source, { chunkSize: 256 }))[Symbol.asyncIterator]();
    expect(read()).toBe(0);
    const header = await iterator.next();
    expect(JSON.parse(header.value as string).type).toBe('header');
    await iterator.next();
    await iterator.next();
    expect(read()).toBeLessThan(total / 4);
    await iterator.return?.();
  });

  it('strips the error causes of diagnostics from AST entries', async () => {
    const entry = {
      headwords: [],
      body: [],
      position: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
      diagnostics: [
        { code: 'DSL4001', severity: 'warning', message: 'm', cause: new Error('boom') },
      ],
    } satisfies Partial<DslEntry>;
    const dict = fake([entry]);
    const lines = await collect(toJsonl(dict));
    expect(records(lines)[1].data.diagnostics).toEqual([
      { code: 'DSL4001', severity: 'warning', message: 'm' },
    ]);
  });

  it('fails with DSL7006 for output that is not JSON, naming the entry', async () => {
    for (const bad of [undefined, 10n, () => 1, circular()]) {
      const plugin = definePlugin({ name: 'bad', version: '1.0.0', setup: () => () => bad });
      const error = await collect(toJsonl(dictOf(TEXT), { plugin })).catch((e: unknown) => e);
      expect(error, String(bad)).toMatchObject({ code: 'DSL7006' });
      expect((error as Error).message).toMatch(/[Ee]ntry 1/);
    }
  });

  it('passes the errors of the plugin and of strict mode through', async () => {
    const failing = definePlugin({
      name: 'failing',
      version: '1.0.0',
      setup: () => () => {
        throw new Error('no');
      },
    });
    expect(
      await collect(toJsonl(dictOf(TEXT), { plugin: failing })).catch((e: unknown) => e),
    ).toMatchObject({ code: 'DSL5002', plugin: 'failing' });
    const strict = parseDsl(`${TEXT}x\n\t{{ open`, { strict: true });
    expect(await collect(toJsonl(strict)).catch((e: unknown) => e)).toMatchObject({
      code: 'DSL2101',
    });
  });

  it('can be iterated once, like the entries', async () => {
    const dict = dictOf(TEXT);
    const out = toJsonl(dict);
    await collect(out);
    expect(await collect(out).catch((e: unknown) => e)).toMatchObject({ code: 'DSL0002' });
  });

  it('types the plugin and its options like entries()', () => {
    const needs = definePlugin({
      name: 'needs',
      version: '1.0.0',
      setup: (_context, options: { readonly separator: string }) => (entry) =>
        entry.headwords.map((h) => h.text).join(options.separator),
    });
    const dict = dictOf(TEXT);
    // Not called: the checks are of the types.
    void (() => {
      // @ts-expect-error The plugin requires options.
      toJsonl(dict, { plugin: needs });
      // @ts-expect-error The plugin has no such option.
      toJsonl(dict, { plugin: plainText, options: { bogus: 1 } });
      // @ts-expect-error The options need a plugin.
      toJson(dict, { options: { separator: ',' } });
      toJsonl(dict, { plugin: needs, options: { separator: ',' }, summary: true });
      toJson(dict, { plugin: plainText, pretty: true });
      toJsonl(dict, { summary: true });
    });
    expect(needs.name).toBe('needs');
  });

  it('validates its arguments synchronously', () => {
    const dict = dictOf(TEXT);
    for (const call of [
      () => toJsonl(null as never),
      () => toJsonl(dict, null as never),
      () => toJsonl(dict, { summary: 1 as never }),
      () => toJsonl(dict, { plugin: {} as never }),
      () => toJsonl({ ...dict, entries: dict.entries } as never),
      () => toJson(dict, { pretty: 'yes' as never }),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: 'DSL0001' }));
    }
  });
});

describe('toJson', () => {
  const read = async (chunks: AsyncIterable<string>) => (await collect(chunks)).join('');

  it('writes one document of the header, the entry payloads and the summary', async () => {
    const text = await read(toJson(dictOf(NOISY), { summary: true }));
    expect(text.endsWith('}\n')).toBe(true);
    const lines = await collect(toJsonl(dictOf(NOISY), { summary: true }));
    const [header, ...rest] = records(lines);
    const summary = rest.pop();
    expect(JSON.parse(text)).toEqual({
      header,
      entries: rest.map((r) => r.data),
      summary,
    });
    expect(text.indexOf('"header"')).toBeLessThan(text.indexOf('"entries"'));
    expect(text.indexOf('"entries"')).toBeLessThan(text.indexOf('"summary"'));
  });

  it('leaves the summary out unless requested, and handles no entries', async () => {
    expect(Object.keys(JSON.parse(await read(toJson(dictOf(TEXT)))))).toEqual([
      'header',
      'entries',
    ]);
    const empty = JSON.parse(await read(toJson(dictOf(HEADER_ONLY), { summary: true })));
    expect(empty.entries).toEqual([]);
    expect(empty.summary.entries).toBe(0);
  });

  it('indents by two spaces when pretty, as JSON.stringify does', async () => {
    for (const [text, summary] of [
      [TEXT, true],
      [TEXT, false],
      [HEADER_ONLY, true],
      [HEADER_ONLY, false],
    ] as const) {
      const pretty = await read(toJson(dictOf(text), { pretty: true, summary }));
      expect(pretty).toBe(`${JSON.stringify(JSON.parse(pretty), null, 2)}\n`);
      const compact = await read(toJson(dictOf(text), { summary }));
      expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
      expect(compact).not.toContain('\n  ');
    }
  });

  it('uses a plugin like toJsonl', async () => {
    const doc = JSON.parse(await read(toJson(dictOf(TEXT), { plugin: plainText })));
    expect(doc.header.plugin.name).toBe('plain-text');
    expect(doc.entries).toEqual([
      { headwords: ['cat'], text: 'n кошка' },
      { headwords: ['dog'], text: 'собака' },
    ]);
  });

  it('streams in several chunks', async () => {
    const chunks = await collect(toJson(dictOf(TEXT)));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});

const HEADER_ONLY = '#NAME "Empty"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "Russian"\n';

function circular(): unknown {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}

/** A minimal stand-in for a parsed dictionary, to feed entries the parser does not produce. */
function fake(entries: readonly unknown[]) {
  const header = {
    directives: [],
    name: 'F',
  };
  const info = { encoding: 'utf-8', source: 'default', bom: false, compression: 'none' };
  return {
    header: Promise.resolve(header),
    info: Promise.resolve(info),
    bodyMode: 'ast',
    diagnostics: [],
    diagnosticCounts: () => ({
      total: 0,
      byCode: {},
      bySeverity: { error: 0, warning: 0, info: 0 },
    }),
    entries: () =>
      (async function* () {
        yield* entries;
      })(),
  } as never;
}
