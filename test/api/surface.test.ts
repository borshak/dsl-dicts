/**
 * The public surface of the package: every name each entry point exports, values and types,
 * against a snapshot. A change of the public API shows up in `public-api.txt`, to be reviewed
 * like code: update it with `npx vitest run --project node test/api -u`.
 *
 * The names come from the entry points' source, which lists every export explicitly (an
 * `export *` would hide names and is refused); the runtime exports of each entry point are
 * checked against the value names, so the list cannot drift from what a consumer imports.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ENTRY_POINTS = {
  'dsl-dicts': '../../src/index.ts',
  'dsl-dicts/plugins': '../../src/plugins/index.ts',
  'dsl-dicts/article': '../../src/article/index.ts',
  'dsl-dicts/node': '../../src/node/index.ts',
} as const;

interface Export {
  readonly name: string;
  readonly kind: 'value' | 'type';
}

/** The exports declared by the source of an entry point. */
function exportsOf(source: string): Export[] {
  if (/^export \*/m.test(source)) throw new Error('An entry point must not use export *.');
  const found: Export[] = [];
  for (const match of source.matchAll(/^export (type )?\{([^}]*)\}(?: from '[^']+')?;/gm)) {
    const allTypes = match[1] !== undefined;
    for (const item of (match[2] as string).split(',').map((part) => part.trim())) {
      if (item.length === 0) continue;
      const type = allTypes || item.startsWith('type ');
      const name = item
        .replace(/^type /, '')
        .split(/\s+as\s+/)
        .at(-1) as string;
      found.push({ name, kind: type ? 'type' : 'value' });
    }
  }
  for (const match of source.matchAll(
    /^export (?:declare )?(const|let|function|class|interface|type|enum) ([A-Za-z_$][\w$]*)/gm,
  )) {
    const kind = match[1] === 'interface' || match[1] === 'type' ? 'type' : 'value';
    found.push({ name: match[2] as string, kind });
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const surface = Object.entries(ENTRY_POINTS).map(([specifier, path]) => ({
  specifier,
  url: new URL(path, import.meta.url),
  exports: exportsOf(readFileSync(new URL(path, import.meta.url), 'utf8')),
}));

describe('public API', () => {
  it('matches the snapshot', async () => {
    const text = surface
      .map(
        ({ specifier, exports }) =>
          `${specifier}\n${exports.map(({ name, kind }) => `  ${kind.padEnd(5)} ${name}`).join('\n')}\n`,
      )
      .join('\n');
    await expect(text).toMatchFileSnapshot('./public-api.txt');
  });

  it.each(surface)('$specifier exports at runtime exactly its values', async ({ url, exports }) => {
    const module = (await import(url.href)) as Record<string, unknown>;
    const values = exports.filter((e) => e.kind === 'value').map((e) => e.name);
    expect(Object.keys(module).sort()).toEqual(values);
    for (const name of values) expect(module[name], name).toBeDefined();
  });

  it('has no name twice in an entry point', () => {
    for (const { specifier, exports } of surface) {
      const names = exports.map((e) => e.name);
      expect(new Set(names).size, specifier).toBe(names.length);
    }
  });
});
