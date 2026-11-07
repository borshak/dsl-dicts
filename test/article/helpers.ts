/**
 * Test helpers for the article plugin. Web-standard APIs only.
 */

import { type Article, type ArticleOptions, article, type Sense } from '../../src/article/index.js';
import { createDictionaryContext, type DslPlugin, parseDsl, setupPlugin } from '../../src/index.js';
import { collect, deepFreeze, HEADER } from '../plugin/helpers.js';

export { collect, deepFreeze, HEADER };

export interface RunInit {
  readonly abbreviations?: ReadonlyMap<string, string>;
  readonly plugin?: DslPlugin<Article, ArticleOptions | undefined>;
  /** The header lines; default `HEADER` (English to Russian). */
  readonly header?: string;
}

/** The articles of a dictionary (the header is prepended), built from deeply frozen entries. */
export async function articlesOf(
  entries: string,
  options?: ArticleOptions,
  init: RunInit = {},
): Promise<Article[]> {
  const dict = parseDsl((init.header ?? HEADER) + entries, { positions: false });
  const list = (await collect(dict.entries())).map(deepFreeze);
  const context = createDictionaryContext({
    header: await dict.header,
    ...(init.abbreviations === undefined ? {} : { abbreviations: init.abbreviations }),
  });
  return list.map(setupPlugin(init.plugin ?? article, context, options));
}

/** The article of a one-entry dictionary. */
export async function articleOf(
  text: string,
  options?: ArticleOptions,
  init: RunInit = {},
): Promise<Article> {
  const [first, ...rest] = await articlesOf(text, options, init);
  if (first === undefined || rest.length > 0) throw new Error('Expected exactly one entry.');
  return first;
}

/** An entry of one headword `w` with the given body lines. */
export function entry(...lines: string[]): string {
  return `w\n${lines.map((l) => `\t${l}`).join('\n')}\n`;
}

/** A sense with empty lists, for `toEqual` with only the fields that matter. */
export function sense(fields: Partial<Sense> = {}): Sense {
  return {
    labels: [],
    translations: [],
    examples: [],
    comments: [],
    references: [],
    senses: [],
    ...fields,
  };
}

/** The senses of a tree as `number: translations` lines, indented by depth. */
export function outline(senses: readonly Sense[], depth = 0): string[] {
  return senses.flatMap((s) => [
    `${'  '.repeat(depth)}${s.number ?? '-'}: ${s.translations.join(' | ')}`,
    ...outline(s.senses, depth + 1),
  ]);
}
