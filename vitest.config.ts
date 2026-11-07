import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  resolve: {
    // The documentation examples import the package by name: map it to the sources.
    alias: [
      { find: /^dsl-dicts$/, replacement: `${src}index.ts` },
      { find: /^dsl-dicts\/(article|node|plugins)$/, replacement: `${src}$1/index.ts` },
    ],
  },
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        // The runtime-neutral core and plugins only: no node:fs.
        extends: true,
        test: {
          name: 'browser',
          include: [
            'test/{article,companion,core,data,decode,diagnostics,headword,markup,parse,plugin,plugins,segment,serialize}/**/*.test.ts',
            // The documentation examples that use the core only.
            'test/docs/core.test.ts',
          ],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
