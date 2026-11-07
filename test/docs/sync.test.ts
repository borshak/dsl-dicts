/**
 * The documentation is up to date: its examples are the files the tests run, its generated
 * regions and `docs/diagnostics.md` match what they are generated from, and its command lines
 * are valid. Update the documents with `npm run docs` (see `generate.ts`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConvert, parseInfo } from '../../src/node/cli/options.js';
import { BUILT_IN_PLUGINS, isPluginPath } from '../../src/node/cli/plugins.js';
import { blocksOf, renderDiagnostics, updateDocument } from './generate.js';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const DOCUMENTS = [
  'README.md',
  'MIGRATION.md',
  'STABILITY.md',
  'CHANGELOG.md',
  ...readdirSync(new URL('docs/', root))
    .filter((name) => name.endsWith('.md') && name !== 'diagnostics.md')
    .map((name) => `docs/${name}`),
];

const LANGUAGES: Readonly<Record<string, string>> = { '.ts': 'ts', '.mjs': 'js' };

const EXAMPLES = Object.fromEntries(
  readdirSync(new URL('test/docs/examples/', root)).map((file) => {
    const extension = file.slice(file.lastIndexOf('.'));
    const language = LANGUAGES[extension];
    if (language === undefined) throw new Error(`Unexpected example file ${file}`);
    const source = read(`test/docs/examples/${file}`);
    return [file.slice(0, -extension.length), { language, source }];
  }),
);

describe('documentation', () => {
  it.each(DOCUMENTS)('%s is up to date (npm run docs)', async (path) => {
    await expect(await updateDocument(read(path), EXAMPLES)).toMatchFileSnapshot(`../../${path}`);
  });

  it('docs/diagnostics.md is up to date (npm run docs)', async () => {
    await expect(renderDiagnostics()).toMatchFileSnapshot('../../docs/diagnostics.md');
  });

  it.each(DOCUMENTS)('%s has no untested TypeScript or JavaScript', (path) => {
    for (const block of blocksOf(read(path))) {
      if (!/^(ts|js|typescript|javascript)\b/.test(block.language)) continue;
      expect(block.kind, `${path}:${block.line} needs <!-- example: name -->`).toMatch(
        /^(example|legacy)$/,
      );
    }
  });

  it('shows every example', () => {
    const shown = new Set(
      DOCUMENTS.flatMap((path) => blocksOf(read(path)))
        .filter((block) => block.kind === 'example')
        .map((block) => block.name),
    );
    expect(Object.keys(EXAMPLES).filter((name) => !shown.has(name))).toEqual([]);
  });

  it.each(DOCUMENTS)('%s has valid dsl-dicts command lines', (path) => {
    for (const block of blocksOf(read(path))) {
      if (!/^(sh|bash|shell|console)$/.test(block.language)) continue;
      for (const line of block.content.replace(/\\\n\s*/g, '').split('\n')) {
        const command = /(?:^|[|;&(]\s*)(?:\$ )?(?:npx )?dsl-dicts (.*)$/.exec(line);
        if (command === null) continue;
        const args = shellWords((command[1] as string).split(/\s(?:\||&&|;|>)\s/)[0] as string);
        const where = `${path}:${block.line}: ${line}`;
        const [name, ...rest] = args;
        if (name === 'convert') {
          const options = parseConvert(rest);
          if (options !== 'help' && options.plugin !== undefined && !isPluginPath(options.plugin)) {
            expect(Object.keys(BUILT_IN_PLUGINS), where).toContain(options.plugin);
          }
        } else if (name === 'info') {
          parseInfo(rest);
        } else {
          expect(['--help', '-h', 'help', '--version', '-v'], where).toContain(name);
        }
      }
    }
  });
});

/** Splits a command line into words: spaces separate, quotes group. */
function shellWords(text: string): string[] {
  const words: string[] = [];
  for (const match of text.trim().matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) {
    words.push(match[1] ?? match[2] ?? (match[3] as string));
  }
  return words;
}
