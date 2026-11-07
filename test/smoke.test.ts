import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as article from '../src/article/index.js';
import * as core from '../src/index.js';
import * as node from '../src/node/index.js';
import * as plugins from '../src/plugins/index.js';

describe('package skeleton', () => {
  it('core exports the version', () => {
    expect(core.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('core version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(core.VERSION).toBe(pkg.version);
  });

  it('node entry builds on the core', () => {
    expect(node.describeRuntime()).toBe(`${core.VERSION} (node)`);
  });

  it('article and plugins entries are importable', () => {
    expect(article.article.name).toBe('article');
    expect(plugins.plainText.name).toBe('plain-text');
    expect(plugins.searchText.name).toBe('search-text');
  });
});
