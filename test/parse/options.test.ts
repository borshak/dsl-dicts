/**
 * The options shared by the readers: `strict` with a severity, `diagnosticsLimit` with exact
 * counts, and `signal`. Web-standard APIs only.
 */

import { describe, expect, it } from 'vitest';
import {
  createCollectingSink,
  createDictionaryContext,
  createPluginDiagnostic,
  type DictionaryContext,
  DslError,
  decodeDsl,
  definePlugin,
  parseAbbreviations,
  parseDsl,
  segmentDsl,
} from '../../src/index.js';
import { collect, HEADER } from '../plugin/helpers.js';

/** Three entries, each with a `DSL4202` (warning), and a `DSL2007` (info) in the header. */
const NOISY =
  '#NAME "x"\n#INDEX_LANGUAGE "english"\n#CONTENTS_LANGUAGE "Russian"\n' +
  'a\n\t[b]x\nb\n\t[i]y\nc\n\t[u]z\n';

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error');
}

describe('strict with a severity', () => {
  it('fails from the severity on: true is error', async () => {
    const outcome = async (strict: boolean | 'error' | 'warning' | 'info') => {
      const error = await collect(parseDsl(NOISY, { strict }).entries()).then(
        () => undefined,
        (e: unknown) => (e as DslError).code,
      );
      return error ?? 'ok';
    };
    expect(await outcome(false)).toBe('ok');
    expect(await outcome(true)).toBe('ok');
    expect(await outcome('error')).toBe('ok');
    expect(await outcome('warning')).toBe('DSL4202');
    expect(await outcome('info')).toBe('DSL2007');
  });

  it('applies to every reader', async () => {
    const latin1 = new Uint8Array([0x61, 0x0a, 0x09, 0xe9, 0x0a]);
    // DSL2001 (warning): the header has no directives.
    expect(
      await errorOf(collect(segmentDsl(latin1, { strict: 'warning' }).entries())),
    ).toMatchObject({ code: 'DSL2001' });
    // DSL2001 is not reported for abbreviations; DSL6002 (an empty one) is a warning.
    expect(
      await errorOf(parseAbbreviations(`${HEADER}a\n\t[b][/b]\n`, { strict: 'warning' })),
    ).toMatchObject({ code: 'DSL6002' });
    expect(await parseAbbreviations(`${HEADER}a\n\t[b][/b]\n`, { strict: true })).toEqual(
      new Map(),
    );
  });

  it('refuses a value that is neither a boolean nor a severity', () => {
    for (const strict of ['fatal', 1, null]) {
      for (const call of [
        () => parseDsl('', { strict: strict as never }),
        () => segmentDsl('', { strict: strict as never }),
        () => decodeDsl('', { strict: strict as never }),
      ]) {
        expect(call).toThrow(expect.objectContaining({ code: 'DSL0001' }));
      }
    }
  });
});

describe('diagnosticsLimit', () => {
  it('keeps the first diagnostics, and counts all of them exactly', async () => {
    const sink = createCollectingSink();
    const dict = parseDsl(NOISY, { diagnosticsLimit: 2, diagnostics: sink });
    const before = dict.diagnostics;
    const entries = await collect(dict.entries());
    expect(dict.diagnostics).toBe(before);
    expect(dict.diagnostics.map((d) => d.code)).toEqual(['DSL2007', 'DSL4202']);
    expect(sink.diagnostics).toHaveLength(4);
    expect(entries.every((e) => e.diagnostics?.length === 1)).toBe(true);
    expect(dict.diagnosticCounts()).toEqual({
      total: 4,
      byCode: { DSL2007: 1, DSL4202: 3 },
      bySeverity: { error: 0, warning: 3, info: 1 },
    });
    // A new object on each call.
    expect(dict.diagnosticCounts()).not.toBe(dict.diagnosticCounts());
  });

  it('can keep none, and has the same counts', async () => {
    const dict = parseDsl(NOISY, { diagnosticsLimit: 0 });
    await collect(dict.batches());
    expect(dict.diagnostics).toEqual([]);
    expect(dict.diagnosticCounts().total).toBe(4);
  });

  it('applies to the decoder and the segmenter, which count too', async () => {
    const text = 'a\n\tb\n';
    const segmented = segmentDsl(text, { diagnosticsLimit: 1 });
    await collect(segmented.entries());
    expect(segmented.diagnostics).toHaveLength(1);
    expect(segmented.diagnosticCounts()).toMatchObject({ total: 3, byCode: { DSL2001: 3 } });
    const decoded = decodeDsl(new Uint8Array([0xff, 0xfe, 0x61, 0x00]), { encoding: 'utf-8' });
    await collect(decoded);
    expect(decoded.diagnosticCounts().byCode).toEqual(
      Object.fromEntries(decoded.diagnostics.map((d) => [d.code, 1])),
    );
  });

  it('counts the diagnostics of plugins, codes of their own included', async () => {
    const reporting = definePlugin({
      name: 'reporting',
      version: '1.0.0',
      setup: (context) => (entry) => {
        context.diagnostics.report(
          createPluginDiagnostic('reporting', 'seen', {
            code: 'reporting/seen',
            severity: 'info',
            position: entry.position,
          }),
        );
        return entry.headwords.length;
      },
    });
    const dict = parseDsl(NOISY, { diagnosticsLimit: 100 });
    await collect(dict.entries({ plugin: reporting }));
    expect(dict.diagnosticCounts()).toEqual({
      total: 7,
      byCode: { DSL2007: 1, DSL4202: 3, 'reporting/seen': 3 },
      bySeverity: { error: 0, warning: 3, info: 4 },
    });
    expect(dict.diagnostics.filter((d) => d.source === 'reporting')).toHaveLength(3);
    // Strict mode applies to them too: a failure of the plugin, caused by the diagnostic.
    const strict = parseDsl(`${HEADER}a\n\tb\n`, { strict: 'info' });
    expect(await errorOf(collect(strict.entries({ plugin: reporting })))).toMatchObject({
      code: 'DSL5002',
      plugin: 'reporting',
      cause: { code: 'reporting/seen' },
    });
  });

  it('refuses a limit that is not a non-negative integer', () => {
    for (const diagnosticsLimit of [-1, 1.5, '10', Number.NaN]) {
      expect(() => parseDsl('', { diagnosticsLimit: diagnosticsLimit as never })).toThrow(
        expect.objectContaining({ code: 'DSL0001' }),
      );
    }
  });
});

describe('the context of plugins', () => {
  const probe = (seen: DictionaryContext[]) =>
    definePlugin({
      name: 'probe',
      version: '1.0.0',
      setup: (context) => {
        seen.push(context);
        return () => 0;
      },
    });

  it('has the decoding info when it is known at setup, without reading ahead', async () => {
    const seen: DictionaryContext[] = [];
    // Non-ASCII text: the encoding is known with the first chunk.
    const bytes = new TextEncoder().encode(`${HEADER}cat\n\tкошка\n`);
    await collect(parseDsl(bytes).entries({ plugin: probe(seen) }));
    expect(seen[0]?.info).toMatchObject({ encoding: 'utf-8', source: 'utf8-detect' });
    expect(seen[0]?.files).toBeUndefined();
    // ASCII only, read in small chunks: the encoding is not final at the first entry.
    const ascii = new TextEncoder().encode(
      HEADER + Array.from({ length: 5000 }, (_, i) => `w${i}\n\tx\n`).join(''),
    );
    const later: DictionaryContext[] = [];
    await collect(parseDsl(ascii, { chunkSize: 128 }).entries({ plugin: probe(later) }));
    expect(later[0]?.info).toBeUndefined();
  });

  it('can be made by hand with the info and the files', () => {
    const info = { encoding: 'utf-8', source: 'bom', bom: true, compression: 'none' } as const;
    const files = { dictionary: '/d/a.dsl', annotation: '/d/a.ann' };
    const context = createDictionaryContext({ info: { ...info, asciiOnly: false }, files });
    expect(context.info?.source).toBe('bom');
    expect(context.files).toBe(files);
    expect(() => createDictionaryContext({ files: {} as never })).toThrow(
      expect.objectContaining({ code: 'DSL0001' }),
    );
    expect(() => createDictionaryContext({ info: 1 as never })).toThrow(
      expect.objectContaining({ code: 'DSL0001' }),
    );
  });

  it('creates plugin diagnostics with a code of the plugin', () => {
    const plugin = { name: 'my-plugin' };
    expect(createPluginDiagnostic(plugin, 'm')).toEqual({
      code: 'DSL5101',
      severity: 'warning',
      message: 'my-plugin: m',
      source: 'my-plugin',
    });
    expect(createPluginDiagnostic(plugin, 'm', { code: 'my-plugin/x', severity: 'error' })).toEqual(
      { code: 'my-plugin/x', severity: 'error', message: 'my-plugin: m', source: 'my-plugin' },
    );
    for (const details of [{ code: '' }, { code: 'a b' }, { code: 1 }, { severity: 'fatal' }]) {
      expect(() => createPluginDiagnostic(plugin, 'm', details as never)).toThrow(
        expect.objectContaining({ code: 'DSL0001' }),
      );
    }
  });
});

describe('signal', () => {
  /** A stream that yields one chunk, then waits forever, until cancelled. */
  function stalled(first: string): {
    stream: ReadableStream<Uint8Array>;
    cancelled: () => boolean;
  } {
    let cancelled = false;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode(first));
        }
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    return { stream, cancelled: () => cancelled };
  }

  it('cancels a pending read and rejects with DSL0003, the reason as the cause', async () => {
    const { stream, cancelled } = stalled(`${HEADER}cat\n\tкошка\n`);
    const controller = new AbortController();
    const dict = parseDsl(stream, { signal: controller.signal });
    const iterator = dict.entries()[Symbol.asyncIterator]();
    const pending = iterator.next();
    const reason = new Error('stop');
    setTimeout(() => controller.abort(reason), 5);
    const error = await errorOf(pending);
    expect(error).toBeInstanceOf(DslError);
    expect(error).toMatchObject({ code: 'DSL0003', cause: reason });
    expect(cancelled()).toBe(true);
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('rejects the header when aborted before it is complete, even without reading', async () => {
    const { stream } = stalled('#NAME "x"\n');
    const controller = new AbortController();
    const dict = parseDsl(stream, { signal: controller.signal });
    const header = dict.header;
    controller.abort();
    expect(await errorOf(header)).toMatchObject({ code: 'DSL0003' });
    expect((await errorOf(dict.info)) as DslError).toMatchObject({ code: 'DSL0003' });
  });

  it('stops before reading when already aborted', async () => {
    let pulled = 0;
    const source = (async function* () {
      pulled++;
      yield new TextEncoder().encode(`${HEADER}a\n\tb\n`);
    })();
    const signal = AbortSignal.abort(new Error('early'));
    for (const reader of [
      () => collect(parseDsl(source, { signal }).entries()),
      () => collect(segmentDsl(`${HEADER}a\n\tb\n`, { signal }).entries()),
      () => collect(decodeDsl(new Uint8Array([0x61]), { signal })),
      () => parseAbbreviations(`${HEADER}a\n\tb\n`, { signal }),
    ]) {
      expect(await errorOf(reader())).toMatchObject({
        code: 'DSL0003',
        cause: expect.objectContaining({ message: 'early' }),
      });
    }
    expect(pulled).toBe(0);
  });

  it('stops between chunks, and drops what was read ahead', async () => {
    const controller = new AbortController();
    const text = HEADER + Array.from({ length: 200 }, (_, i) => `w${i}\n\tx\n`).join('');
    const dict = parseDsl(text, { signal: controller.signal, chunkSize: 64 });
    const seen: string[] = [];
    const error = await errorOf(
      (async () => {
        for await (const entry of dict.entries()) {
          seen.push(entry.headwords[0]?.text ?? '');
          if (seen.length === 3) controller.abort();
        }
      })(),
    );
    expect(error).toMatchObject({ code: 'DSL0003' });
    expect(seen.length).toBeLessThan(10);
  });

  it('is harmless once reading is over', async () => {
    const controller = new AbortController();
    const dict = parseDsl(`${HEADER}a\n\tb\n`, { signal: controller.signal });
    expect(await collect(dict.entries())).toHaveLength(1);
    controller.abort();
    expect((await dict.header).name).toBe('Test');
  });

  it('refuses what is not an AbortSignal', () => {
    for (const signal of [{}, 'x', { aborted: false }]) {
      expect(() => parseDsl('', { signal: signal as never })).toThrow(
        expect.objectContaining({ code: 'DSL0001' }),
      );
    }
  });
});
