import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
            'test/{article,companion,core,data,decode,diagnostics,headword,markup,parse,plugin,plugins,segment}/**/*.test.ts',
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
