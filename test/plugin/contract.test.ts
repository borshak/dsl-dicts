import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AST_VERSION,
  createCollectingSink,
  createDictionaryContext,
  createPluginDiagnostic,
  type DictionaryContext,
  type DslError,
  type DslPlugin,
  definePlugin,
  type EntryTransform,
  type ParsedDsl,
  type PluginEntry,
  parseDsl,
  setupPlugin,
  VERSION,
} from '../../src/index.js';
import { type PlainTextResult, plainText } from '../../src/plugins/index.js';
import { collect, deepFreeze, entriesOf, HEADER, thrown } from './helpers.js';

const TEXT = `${HEADER}one\n\t[m1]first[/m]\ntwo\n\tsecond\nthree\n\tthird\n`;

/** A plugin that records its setups and calls. */
function recorder() {
  const log = { setups: [] as DictionaryContext[], calls: 0 };
  const plugin = definePlugin({
    name: 'recorder',
    version: '1.2.3-beta.1+build.5',
    setup(context, options: { readonly prefix: string }) {
      log.setups.push(context);
      return (entry) => {
        log.calls++;
        return `${options.prefix}${entry.headwords[0]?.text}`;
      };
    },
  });
  return { plugin, log };
}

/** A plugin whose setup or transform throws. */
function failing(where: 'setup' | 'entry', error: unknown = new RangeError('boom')) {
  return definePlugin({
    name: 'failing',
    version: '0.1.0',
    setup() {
      if (where === 'setup') throw error;
      return (entry) => {
        if (entry.headwords[0]?.text === 'two') throw error;
        return entry.headwords.length;
      };
    },
  });
}

describe('plugin types', () => {
  it('infers the output and options types', () => {
    const { plugin } = recorder();
    expectTypeOf(plugin).toEqualTypeOf<DslPlugin<string, { readonly prefix: string }>>();
    expectTypeOf(plainText.setup).returns.toEqualTypeOf<EntryTransform<PlainTextResult>>();
    expectTypeOf<EntryTransform<string>>().parameter(0).toEqualTypeOf<PluginEntry>();
    expectTypeOf(parseDsl(TEXT).entries({ plugin, options: { prefix: '' } })).toEqualTypeOf<
      AsyncIterable<string>
    >();
    expectTypeOf(parseDsl(TEXT).batches({ plugin, options: { prefix: '' } })).toEqualTypeOf<
      AsyncIterable<string[]>
    >();
    expectTypeOf(parseDsl(TEXT).entries({ plugin: plainText })).toEqualTypeOf<
      AsyncIterable<PlainTextResult>
    >();
    expectTypeOf(setupPlugin(plainText, createDictionaryContext())).toEqualTypeOf<
      EntryTransform<PlainTextResult>
    >();
  });

  it('rejects missing or wrong options, and plugins on raw bodies', () => {
    const { plugin } = recorder();
    const context = createDictionaryContext();
    // Type-level checks only: never called.
    const unused = () => {
      // @ts-expect-error The options are required.
      parseDsl(TEXT).entries({ plugin });
      // @ts-expect-error The options have the wrong type.
      parseDsl(TEXT).entries({ plugin, options: { prefix: 1 } });
      // @ts-expect-error The options are required.
      setupPlugin(plugin, context);
      // @ts-expect-error Plugins need parsed bodies.
      parseDsl(TEXT, { body: 'raw' }).entries({ plugin: plainText });
    };
    expect(unused).toBeTypeOf('function');
  });
});

describe('parseDsl with a plugin', () => {
  it('sets the plugin up once, after the header, and applies it to every entry', async () => {
    const { plugin, log } = recorder();
    const sink = createCollectingSink();
    const abbreviations = new Map([['adj.', 'adjective']]);
    const dict = parseDsl(TEXT, { diagnostics: sink, abbreviations, annotation: 'About' });
    const out = await collect(dict.entries({ plugin, options: { prefix: '>' } }));
    expect(out).toEqual(['>one', '>two', '>three']);
    expect(log.setups).toHaveLength(1);
    expect(log.calls).toBe(3);
    const context = log.setups[0] as DictionaryContext;
    expect(context).toMatchObject({
      header: { name: 'Test', indexLanguage: 'English' },
      astVersion: AST_VERSION,
      packageVersion: VERSION,
      abbreviations,
      annotation: { sections: [{ text: 'About' }], text: 'About' },
    });
    expect(context.header.contentsLanguageInfo?.iso639_1).toBe('ru');
    expect(Object.isFrozen(context)).toBe(true);
    // Reports go to the sink of the options.
    context.diagnostics.report(createPluginDiagnostic(plugin, 'Hello.'));
    expect(sink.diagnostics.at(-1)).toMatchObject({
      code: 'DSL5101',
      message: 'recorder: Hello.',
      source: 'recorder',
    });
  });

  it('yields batches of outputs', async () => {
    const { plugin, log } = recorder();
    const batches = await collect(
      parseDsl(TEXT, { chunkSize: 16 }).batches({ plugin, options: { prefix: '' } }),
    );
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(['one', 'two', 'three']);
    expect(log.setups).toHaveLength(1);
  });

  it('does not set up before the first entry is requested, nor after an early stop', async () => {
    const { plugin, log } = recorder();
    const iterable = parseDsl(TEXT).entries({ plugin, options: { prefix: '' } });
    expect(log.setups).toHaveLength(0);
    for await (const out of iterable) {
      expect(out).toBe('one');
      break;
    }
    expect(log.setups).toHaveLength(1);
    expect(log.calls).toBe(1);
  });

  it('can be read only once, like the entries', () => {
    const dict = parseDsl(TEXT);
    dict.entries();
    expect(thrown(() => dict.entries({ plugin: plainText }))).toMatchObject({
      code: 'DSL0002',
    });
  });

  it('rejects invalid plugins and raw bodies synchronously', () => {
    const cases: unknown[] = [
      null,
      { name: 'x', version: '1.0.0' },
      { name: '', version: '1.0.0', setup() {} },
      { name: 'two words', version: '1.0.0', setup() {} },
      { name: 'x', version: '1.0', setup() {} },
      { name: 'x', version: 'v1.0.0', setup() {} },
    ];
    for (const plugin of cases) {
      const use = { plugin } as never;
      expect(thrown(() => parseDsl(TEXT).entries(use))).toMatchObject({ code: 'DSL0001' });
    }
    expect(thrown(() => parseDsl(TEXT).entries(null as never))).toMatchObject({
      code: 'DSL0001',
    });
    const raw = parseDsl(TEXT, { body: 'raw' }) as unknown as ParsedDsl;
    expect(thrown(() => raw.entries({ plugin: plainText }))).toMatchObject({
      code: 'DSL0001',
      message: expect.stringContaining('plain-text'),
    });
  });

  it('checks the context options when parsing starts', () => {
    expect(thrown(() => parseDsl(TEXT, { abbreviations: {} as never }))).toMatchObject({
      code: 'DSL0001',
    });
    expect(thrown(() => parseDsl(TEXT, { annotation: 1 as never }))).toMatchObject({
      code: 'DSL0001',
    });
  });
});

describe('plugin errors', () => {
  it('wrap a failing setup as DSL5001, with the plugin name and the cause', async () => {
    const cause = new RangeError('boom');
    const error = (await collect(parseDsl(TEXT).entries({ plugin: failing('setup', cause) })).catch(
      (e: unknown) => e,
    )) as DslError;
    expect(error).toMatchObject({ name: 'DslError', code: 'DSL5001', plugin: 'failing', cause });
    expect(error.message).toBe('Plugin failing@0.1.0 failed to set up: boom');
  });

  it('wrap a setup that returns no function as DSL5001', async () => {
    const plugin = definePlugin({ name: 'empty', version: '1.0.0', setup: () => 42 as never });
    const error = await collect(parseDsl(TEXT).entries({ plugin })).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'DSL5001', plugin: 'empty' });
  });

  it('wrap a failing transform as DSL5002, with the entry position, and stop', async () => {
    const seen: number[] = [];
    const dict = parseDsl(TEXT);
    const error = await (async () => {
      for await (const out of dict.entries({ plugin: failing('entry', 'not an error') })) {
        seen.push(out);
      }
    })().catch((e: unknown) => e);
    expect(seen).toEqual([1]);
    expect(error).toMatchObject({
      code: 'DSL5002',
      plugin: 'failing',
      cause: 'not an error',
      position: { line: 6, column: 1 },
      message: 'Plugin failing@0.1.0 failed on the entry at line 6: not an error',
    });
  });

  it('pass input errors through unchanged, without setting up', async () => {
    const { plugin, log } = recorder();
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array();
      throw new Error('disk');
    }
    const error = await collect(
      parseDsl(broken()).entries({ plugin, options: { prefix: '' } }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'DSL1001' });
    expect(log.setups).toHaveLength(0);
  });

  it('turn an error diagnostic of a plugin in strict mode into DSL5002', async () => {
    const plugin = definePlugin({
      name: 'strict-reporter',
      version: '1.0.0',
      setup: (context) => (entry) => {
        context.diagnostics.report(
          createPluginDiagnostic('strict-reporter', 'Bad entry.', {
            severity: 'error',
            position: entry.position,
          }),
        );
        return null;
      },
    });
    const error = await collect(parseDsl(TEXT, { strict: true }).entries({ plugin })).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: 'DSL5002',
      cause: { code: 'DSL5101', diagnostic: { severity: 'error' } },
    });
  });

  it('catch a plugin that mutates its (frozen) input', async () => {
    const mutating = definePlugin({
      name: 'mutating',
      version: '1.0.0',
      setup: () => (entry) => {
        (entry.headwords as unknown as unknown[]).push('x');
        return entry;
      },
    });
    const [entry] = await entriesOf('a\n\tb\n');
    const run = setupPlugin(mutating, createDictionaryContext());
    expect(thrown(() => run(deepFreeze(entry as PluginEntry)))).toMatchObject({
      code: 'DSL5002',
      cause: expect.any(TypeError),
    });
  });
});

describe('manual setup', () => {
  it('creates a frozen default context', () => {
    const context = createDictionaryContext();
    expect(context).toEqual({
      header: { directives: [] },
      astVersion: AST_VERSION,
      packageVersion: VERSION,
      diagnostics: expect.any(Object),
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => context.diagnostics.report(createPluginDiagnostic('x', 'dropped'))).not.toThrow();
  });

  it('checks its arguments', () => {
    for (const init of [
      null,
      { header: {} },
      { diagnostics: {} },
      { abbreviations: [] },
      { annotation: 1 },
    ]) {
      expect(thrown(() => createDictionaryContext(init as never))).toMatchObject({
        code: 'DSL0001',
      });
    }
    expect(thrown(() => setupPlugin(plainText, null as never))).toMatchObject({
      code: 'DSL0001',
    });
  });

  it('runs a plugin by hand, with setupPlugin or setup itself', async () => {
    const entries = await entriesOf('a\n\tb\n');
    const context = createDictionaryContext();
    const viaSetupPlugin = setupPlugin(plainText, context);
    const viaSetup = plainText.setup(context, undefined);
    expect(entries.map(viaSetupPlugin)).toEqual([{ headwords: ['a'], text: 'b' }]);
    expect(entries.map(viaSetup)).toEqual(entries.map(viaSetupPlugin));
  });

  it('builds plugin diagnostics', () => {
    const position = { offset: 0, line: 1, column: 1 };
    expect(createPluginDiagnostic(plainText, 'Note.', { severity: 'info', position })).toEqual({
      code: 'DSL5101',
      severity: 'info',
      message: 'plain-text: Note.',
      position,
      source: 'plain-text',
    });
    const diagnostic = createPluginDiagnostic('x', 'Note.');
    expect(diagnostic).toEqual({
      code: 'DSL5101',
      severity: 'warning',
      message: 'x: Note.',
      source: 'x',
    });
    // The source survives JSON, like every field but cause.
    expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(diagnostic);
  });

  it('keeps definePlugin an identity', () => {
    const plugin = { name: 'id', version: '1.0.0', setup: () => () => 1 };
    expect(definePlugin(plugin)).toBe(plugin);
    expect(thrown(() => definePlugin({ ...plugin, version: '1' }))).toMatchObject({
      code: 'DSL0001',
    });
  });
});
