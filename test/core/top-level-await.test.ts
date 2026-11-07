import { describe, expect, it } from 'vitest';

// Bundler-level imports instead of node:fs, so the test also runs in a browser.
const sources = import.meta.glob<string>('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('top-level await', () => {
  // `require(esm)` rejects modules that use top-level await, so no module may use it.
  // Formatted code has top-level statements at column 0 and everything nested indented, so a
  // column-0 line with `await` (or `for await`) is a top-level await.
  it('is not used in any source module', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    for (const [file, code] of Object.entries(sources)) {
      expect(code, file).not.toMatch(/^[^\s/*].*\bawait\b/m);
    }
  });
});
