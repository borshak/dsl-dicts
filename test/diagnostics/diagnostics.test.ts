import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDiagnostic } from '../../src/diagnostics/index.js';
import {
  createCollectingSink,
  createStrictSink,
  DIAGNOSTICS,
  type Diagnostic,
  DslError,
  findDiagnosticSpec,
} from '../../src/index.js';

const SRC = new URL('../../src/', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const specs = Object.entries(DIAGNOSTICS);

describe('diagnostic catalog', () => {
  it('has unique, well-formed codes in ascending order', () => {
    const codes = specs.map(([, spec]) => spec.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^DSL\d{4}$/);
    expect([...codes].sort()).toEqual(codes);
  });

  it('keeps codes of thrown errors in the API and input ranges', () => {
    for (const [, spec] of specs) {
      if ('thrown' in spec) expect(spec.code, spec.code).toMatch(/^DSL[01]0/);
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
    for (const file of sourceFiles(SRC)) {
      for (const [code] of readFileSync(file, 'utf8').matchAll(/\bDSL\d{4}\b/g)) {
        expect(known.has(code), `${code} in ${file}`).toBe(true);
      }
    }
  });

  it('uses every catalog entry in the source code', () => {
    const sources = sourceFiles(SRC)
      .filter((file) => !file.endsWith('catalog.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    for (const [name] of specs) expect(sources, name).toMatch(new RegExp(`'${name}'`));
  });

  it('finds specs by code', () => {
    expect(findDiagnosticSpec('DSL1202')).toBe(DIAGNOSTICS.unknownCodePage);
    expect(findDiagnosticSpec('DSL9999')).toBeUndefined();
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

  it('DslError.of looks up the code', () => {
    const cause = new Error('c');
    const e = DslError.of('unknownEncoding', 'm', cause);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: 'DSL1002', message: 'm', cause });
    expect(e.diagnostic).toBeUndefined();
    expect('cause' in DslError.of('unknownEncoding', 'm')).toBe(false);
  });

  it('keeps diagnostics serializable', () => {
    const plain: Diagnostic = createDiagnostic('bomMismatch', 'm', {
      position: { offset: 0, line: 1, column: 1 },
    });
    expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
  });
});

describe('core isomorphism', () => {
  it('uses no Node.js APIs outside src/node and src/cli.ts', () => {
    const core = sourceFiles(SRC).filter(
      (file) => !file.includes('/src/node/') && !file.endsWith('/src/cli.ts'),
    );
    for (const file of core) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/from 'node:|\bBuffer\b|\bprocess\.|\brequire\(/);
      // Formatted code has top-level statements at column 0.
      expect(code, file).not.toMatch(/^(?:for )?await\b/m);
    }
  });
});
