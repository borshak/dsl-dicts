# Migrating from 1.x to 2.0

dsl-dicts 2.0 is a rewrite. The 1.x API (`parse()`, `meta`, the `phrase` iterator) is gone:
2.0 parses the whole DSL format into an exact AST, and the closest thing to the 1.x phrase
object is the output of the `article` plugin. This guide maps one to the other.

## Requirements

- Node.js 22.12 or later, or a browser. (1.x declared no requirement.)
- The package is ESM only. `import` it; `require('dsl-dicts')` still works on Node.js 22.12+
  through `require(esm)`, and returns the same exports.
- TypeScript types are included.

## Reading a dictionary

dsl-dicts 1.x:

<!-- legacy -->
```js
const dslDicts = require('dsl-dicts');

dslDicts.parse(contentOfFileWithDslDictionary).then((dict) => {
  console.log(dict.meta.name, dict.meta.language.source, dict.meta.language.target);
  for (const phrase of dict.phrase) console.log(phrase);
});
```

dsl-dicts 2.0:

<!-- example: migration-quick -->
```ts
import { readFile } from 'node:fs/promises';
import { parseDsl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';

// 1.x took a decoded string; 2.0 takes the bytes and detects the encoding.
const dict = parseDsl(await readFile('dictionaries/en-de.dsl'));

// 1.x: dict.meta.name and dict.meta.language.{source, target}
const header = await dict.header;
console.log(header.name, header.indexLanguageInfo?.name, header.contentsLanguageInfo?.name);

// 1.x: for (const phrase of dict.phrase) — one item per headword, a synchronous iterator.
// 2.0: one item per entry (with all its headwords), an async iterator; errors reject.
for await (const entry of dict.entries({ plugin: article })) {
  console.log(
    entry.headwords.map((h) => h.text),
    entry.transcriptions,
    entry.senses.length,
  );
}
```

| 1.x | 2.0 |
| --- | --- |
| `parse(text)`: a promise of `{ meta, phrase }` | `parseDsl(source)` returns a `ParsedDsl` at once; reading happens as you iterate. In Node.js, `openDsl(path)` (from `dsl-dicts/node`) also reads the companion files. |
| The input: a string you decoded yourself | Bytes (`Uint8Array`, `Buffer`, `ArrayBuffer`), a `Blob` or `File`, a stream, or a string. The encoding and `.dz` compression are detected. |
| `dict.meta.name` | `(await dict.header).name` |
| `dict.meta.language.source`, `.target` | `header.indexLanguage`, `header.contentsLanguage` (as written), and `header.indexLanguageInfo`, `contentsLanguageInfo` (the resolved language: `name`, `lcid`, ISO codes) |
| `dict.phrase`: a synchronous iterator, one item per headword | `dict.entries({ plugin: article })`: an async iterator, one item per entry with all its headwords. Without a plugin, the AST entries. |
| `ParseError` | `DslError`, with a stable `code` (`DSL0001`...) |
| Unsupported markup silently dropped | Everything parsed; problems reported as diagnostics |

The entries can be read once, like `dict.phrase` could; 2.0 throws `DSL0002` on a second read
instead of yielding nothing.

## From the phrase object to the article

A 1.x phrase:

<!-- legacy -->
```js
{
  phrase: 'cat',
  transcription: 'kæt',
  explanations: [
    { translations: ['Katze'], examples: [{ English: 'a black cat', German: 'eine schwarze Katze' }] },
  ],
}
```

The `article` plugin gives one `Article` per entry ([the model](docs/plugins.md#the-model)):

| 1.x | `Article` |
| --- | --- |
| `phrase` | `headwords[i].text`: one article per entry, with every headword; `headwords[i].variants` has the index forms (`colo(u)r` gives `color`, `colour`). |
| `transcription` | `transcriptions[0]`; `transcriptions` has them all. |
| `explanations` | `senses`: a tree, by numbering (`1.`, `1)`, `а)`) and `[m]` levels, with `number` and sub-`senses`. |
| `explanations[i].translations` | `senses[i].translations`: the `[trn]` text, with labels (`[p]`) and comments (`[com]`) taken out, split at semicolons (option `splitTranslations: false` keeps a zone whole). |
| `explanations[i].examples` | `senses[i].examples` |
| `examples[j].English` (the source language name as the key) | `examples[j].source.text`, and the language in `examples[j].source.language` |
| `examples[j].Russian` (the target language name as the key) | `examples[j].target?.text`, and `examples[j].target?.language` |
| (not available) | `labels` (with their `expansion` from `_abrv.dsl`), `comments`, `references` (links), `media`, `subentries`, `notes`, `kind` |

1.x did not build senses: an explanation gathered the `[trn]` lines up to the next `[ex]` line,
and the examples after them. Where the dictionary numbers its senses, the article follows the
numbering instead, so the grouping differs. A body without any zone gave one explanation with
the body lines as translations; the article gives one unnumbered sense with the same (`kind`
`plain`).

### Rebuilding the 1.x shape

If you need the old objects, for example to keep an application working while you migrate,
this function makes them from articles: one phrase per headword, an explanation per sense that
has translations or examples, examples keyed by language name.

<!-- example: migration-legacy -->
```ts
import type { DslHeader } from 'dsl-dicts';
import type { Article, Sense } from 'dsl-dicts/article';

/** A phrase of dsl-dicts 1.x. */
export interface LegacyPhrase {
  phrase: string;
  transcription?: string;
  explanations: { translations: string[]; examples?: Record<string, string>[] }[];
}

/** The 1.x phrases of an article: one per headword, an explanation per sense with content. */
export function toLegacyPhrases(article: Article, header: DslHeader): LegacyPhrase[] {
  const target = header.contentsLanguageInfo?.name ?? 'target';
  const explanations: LegacyPhrase['explanations'] = [];
  const visit = (senses: readonly Sense[]): void => {
    for (const { translations, examples, senses: children } of senses) {
      const pairs = examples.map(({ source, target: text }) => ({
        [source.language ?? 'source']: source.text,
        [target]: text?.text ?? '',
      }));
      if (translations.length > 0 || pairs.length > 0) {
        explanations.push({
          translations: [...translations],
          ...(pairs.length > 0 && { examples: pairs }),
        });
      }
      visit(children);
    }
  };
  visit(article.senses);
  const [transcription] = article.transcriptions;
  // A fresh object per headword: 1.x shared one, and only the last headword survived.
  return article.headwords.map(({ text }) => ({
    phrase: text,
    ...(transcription !== undefined && { transcription }),
    explanations: structuredClone(explanations),
  }));
}

// const header = await dict.header;
// for await (const entry of dict.entries({ plugin: article, options: { splitTranslations: false } }))
//   for (const phrase of toLegacyPhrases(entry, header)) console.log(phrase);
```

The article format is experimental: it may change in a minor version (see
[STABILITY.md](STABILITY.md)).

## Behaviour fixes

Code that worked around these 1.x bugs can drop the workarounds:

- **Headwords sharing a body.** For an entry with several headwords, 1.x yielded the same
  object once per headword, overwriting `phrase` each time: kept in an array, they all showed
  the last headword. 2.0 yields one fresh object per entry, with every headword in `headwords`.
- **The last entry was lost** when the file ended with headwords without a body. 2.0 keeps it,
  with an empty body, and reports `DSL2204`.
- **Unsupported source language accepted.** 1.x checked the target language twice and the
  source language never, so any `#INDEX_LANGUAGE` passed, while an unknown
  `#CONTENTS_LANGUAGE` or `[lang id]` failed. 2.0 knows every Lingvo language, resolves names
  as GoldenDict does, and reports an unknown language as a warning (`DSL2005`, `DSL4106`)
  without failing, unless you ask for `strict` mode.
- **Windows line endings.** 1.x split lines on the line ending of the operating system it ran
  on, so it failed on Windows, and read `\r\n` files elsewhere by chance. 2.0 normalizes
  `\r\n`, `\r` and `\n` on every platform.
- **Errors outside the promise.** 1.x resolved its promise before parsing the entries, so an
  error while iterating (an unknown language id) was thrown by the iterator, not by the
  promise. In 2.0, invalid arguments throw from the call, and every problem with the input is
  either a diagnostic or a `DslError` that rejects the iteration or promise that needs it.
- **Example targets with labels.** 1.x cut the target of an example at `[/lang]` and removed
  only a dash at its very start, so in `[lang id=1033]Time flies.[/lang] [p]prov.[/p] — Die
  Zeit vergeht.` the target was `' prov. — Die Zeit vergeht.'`. 2.0 gives the target
  `Die Zeit vergeht.` and the example the label `prov.`.

And what 1.x did not support at all: headword syntax (`(...)`, `{...}`, escapes), `~`,
comments, sub-entries, links, media, `[lang name="..."]`, examples without `[lang]` (dropped),
several zones on one line (merged), encodings, `.dz` files, and streaming: 1.x needed the whole
dictionary as one string in memory.
