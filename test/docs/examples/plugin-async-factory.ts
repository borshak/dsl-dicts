import { definePlugin } from 'dsl-dicts';

/**
 * `setup` is synchronous: a plugin that needs asynchronous resources is made by an
 * asynchronous factory, which loads them first.
 */
export async function createFrequencyPlugin(load: () => Promise<string>) {
  // One word per line, the most frequent first.
  const ranks = new Map((await load()).split('\n').map((word, index) => [word, index + 1]));
  return definePlugin({
    name: 'frequency',
    version: '1.0.0',
    setup: () => (entry) => ({
      headword: entry.headwords[0]?.text ?? '',
      rank: entry.headwords[0]?.variants.map((form) => ranks.get(form)).find(Boolean) ?? null,
    }),
  });
}

// const frequency = await createFrequencyPlugin(() => fetch('/words.txt').then((r) => r.text()));
// for await (const { headword, rank } of parseDsl(file).entries({ plugin: frequency })) …
