import { describe, expect, expectTypeOf, it } from 'vitest';
import { CATALOG, createDiagnostic, dslError } from '../../src/diagnostics/index.js';
import {
  createCollectingSink,
  createStrictSink,
  DIAGNOSTICS,
  type Diagnostic,
  DslError,
  findDiagnosticSpec,
  type Severity,
} from '../../src/index.js';

// Bundler-level imports instead of node:fs, so the test also runs in a browser.
const sources = import.meta.glob<string>('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const specs = Object.entries(CATALOG);

describe('diagnostic catalog', () => {
  it('has unique, well-formed codes in ascending order', () => {
    const codes = specs.map(([, spec]) => spec.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^DSL\d{4}$/);
    expect([...codes].sort()).toEqual(codes);
  });

  it('keeps codes of thrown errors in the API, input, plugin failure and serialization ranges', () => {
    for (const [, spec] of specs) {
      if ('thrown' in spec) expect(spec.code, spec.code).toMatch(/^DSL[0157]0/);
    }
  });

  it('has a one-line summary per code', () => {
    for (const [name, spec] of specs) {
      expect(spec.summary, name).toMatch(/^[A-Z].*\.$/);
      expect(spec.summary, name).not.toMatch(/\n/);
    }
  });

  it('lists every code mentioned in the source code', () => {
    const known = new Set<string>(specs.map(([, spec]) => spec.code));
    for (const [file, code] of Object.entries(sources)) {
      for (const [mentioned] of code.matchAll(/\bDSL\d{4}\b/g)) {
        expect(known.has(mentioned), `${mentioned} in ${file}`).toBe(true);
      }
    }
  });

  it('uses every catalog entry in the source code', () => {
    const others = Object.entries(sources)
      .filter(([file]) => !file.endsWith('catalog.ts'))
      .map(([, code]) => code)
      .join('\n');
    for (const [name] of specs) expect(others, name).toMatch(new RegExp(`'${name}'`));
  });

  it('finds specs by code', () => {
    expect(findDiagnosticSpec('DSL1202')).toBe(DIAGNOSTICS.get('DSL1202'));
    expect(findDiagnosticSpec('DSL1202')).toEqual({
      ...CATALOG.unknownCodePage,
      name: 'unknownCodePage',
    });
    expect(findDiagnosticSpec('DSL9999')).toBeUndefined();
    expect(findDiagnosticSpec('my-plugin/x')).toBeUndefined();
  });

  it('exports the catalog by code, in code order, with informational names', () => {
    expect([...DIAGNOSTICS.keys()]).toEqual(specs.map(([, spec]) => spec.code));
    for (const [code, spec] of DIAGNOSTICS) {
      expect(spec.code).toBe(code);
      expect(Object.isFrozen(spec)).toBe(true);
      expect(spec.name).toMatch(/^[a-z][A-Za-z]+$/);
    }
  });
});

describe('sinks and DslError', () => {
  const warning = createDiagnostic('unknownCodePage', 'w', { byteOffset: 3 });
  const error = createDiagnostic('decompressionFailed', 'e', { cause: new Error('x') });

  it('creates diagnostics with the default severity', () => {
    expect(warning).toEqual({ code: 'DSL1202', severity: 'warning', message: 'w', byteOffset: 3 });
    expect(error.severity).toBe('error');
  });

  it('collects diagnostics', () => {
    const sink = createCollectingSink();
    sink.report(warning);
    sink.report(error);
    expect(sink.diagnostics).toEqual([warning, error]);
  });

  it('strict sink forwards everything and throws DslError on errors only', () => {
    const inner = createCollectingSink();
    const strict = createStrictSink(inner);
    strict.report(warning);
    let thrown: unknown;
    try {
      strict.report(error);
    } catch (e) {
      thrown = e;
    }
    expect(inner.diagnostics).toEqual([warning, error]);
    expect(thrown).toBeInstanceOf(DslError);
    const dslError = thrown as DslError;
    expect(dslError.code).toBe('DSL1101');
    expect(dslError.diagnostic).toBe(error);
    expect(dslError.cause).toBe(error.cause);
    expect(dslError.name).toBe('DslError');
    expect(dslError.message).toBe('e');
  });

  it('strict sink works without an inner sink', () => {
    expect(() => createStrictSink().report(warning)).not.toThrow();
    expect(() => createStrictSink().report(error)).toThrow(DslError);
  });

  it('strict sink fails from a severity on', () => {
    const info = createDiagnostic('codePageIgnored', 'i');
    const fails = (severity: Severity, diagnostic: Diagnostic): boolean => {
      try {
        createStrictSink(undefined, severity).report(diagnostic);
        return false;
      } catch {
        return true;
      }
    };
    expect([info, warning, error].map((d) => fails('error', d))).toEqual([false, false, true]);
    expect([info, warning, error].map((d) => fails('warning', d))).toEqual([false, true, true]);
    expect([info, warning, error].map((d) => fails('info', d))).toEqual([true, true, true]);
    expect(() => createStrictSink(undefined, 'fatal' as Severity)).toThrow(
      expect.objectContaining({ code: 'DSL0001' }),
    );
  });

  it('creates errors by name internally, and by any code publicly', () => {
    const cause = new Error('c');
    const e = dslError('unknownEncoding', 'm', cause);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: 'DSL1002', message: 'm', cause });
    expect(e.diagnostic).toBeUndefined();
    expect('cause' in dslError('unknownEncoding', 'm')).toBe(false);
    const custom = new DslError('my-plugin/x', 'n', { plugin: 'my-plugin' });
    expect(custom).toMatchObject({ code: 'my-plugin/x', plugin: 'my-plugin' });
    // Fields that are not set are not own properties.
    expect(Object.keys(custom).sort()).toEqual(['code', 'name', 'plugin']);
  });

  it('admits codes of plugins in diagnostics', () => {
    const diagnostic: Diagnostic = { code: 'my-plugin/x', severity: 'info', message: 'm' };
    expectTypeOf(diagnostic.code).toExtend<string>();
    expect(diagnostic.code).toBe('my-plugin/x');
  });

  it('keeps diagnostics serializable', () => {
    const plain: Diagnostic = createDiagnostic('bomMismatch', 'm', {
      position: { offset: 0, line: 1, column: 1 },
    });
    expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
  });
});
