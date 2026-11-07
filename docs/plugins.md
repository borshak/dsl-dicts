# Plugins

A plugin turns parsed entries into something else: plain text, search text, an article, HTML,
rows for a database. It is a plain object, passed explicitly where it is used; there is no
registry and no hidden state. The built-in plugins are written against the public API only,
like any other.

- [The contract](#the-contract)
- [Using a plugin](#using-a-plugin)
- [Errors](#errors)
- [Diagnostics of a plugin](#diagnostics-of-a-plugin)
- [Asynchronous resources](#asynchronous-resources)
- [Versioning the output](#versioning-the-output)
- [Rendering helpers](#rendering-helpers)
- [`plain-text`](#plain-text)
- [`search-text`](#search-text)
- [`article` (experimental)](#article-experimental)

## The contract

A `DslPlugin<TOut, TOptions>` has three members:

| Member    | Meaning |
| --------- | ------- |
| `name`    | A unique name without whitespace, in kebab case by convention: `plain-text`. It names the plugin in errors, diagnostics and exports. |
| `version` | The semantic version of the plugin's **output format**, not of its code (see [Versioning the output](#versioning-the-output)). |
| `setup(context, options)` | Called once per dictionary; returns the function that transforms each entry. |

The rules:

- `setup` is called **once per dictionary, synchronously**, as soon as the header is complete,
  with a `DictionaryContext` and the options given by the caller. It checks the options and
  prepares what it needs (lookups, compiled patterns), then returns the transform.
- The transform is called **synchronously for every entry**, in order, and returns **exactly
  one output per entry**: there is no filtering and no merging. Return `null` or an empty value
  for an entry you have nothing to say about. Synchronous calls keep reading streaming.
- Neither may mutate its input: entries are shared read-only data (the tests of the built-in
  plugins run them on deeply frozen entries).
- Keep the output JSON-serializable, so that it can be exported (`toJsonl` refuses an output
  that is not JSON, such as `undefined`: `DSL7006`).

`definePlugin` declares a plugin: it checks the name, the version and `setup` (`DSL0001`), and
lets TypeScript infer the output and option types from `setup`. `TOptions` is `void` for none,
or `X | undefined` for optional options, which callers may then leave out.

<!-- example: plugin-contract -->
```ts
import { createPluginDiagnostic, DslError, definePlugin, parseDsl, zoneText } from 'dsl-dicts';

/** Options of the `translations` plugin. */
export interface TranslationsOptions {
  /** The zone tags whose text is a translation. Default `['trn']`. */
  readonly zones?: readonly string[];
}

/** What the plugin makes of an entry: JSON-serializable, so that it can be exported. */
export interface TranslationsResult {
  readonly headword: string;
  readonly translations: readonly string[];
}

export const translations = definePlugin({
  name: 'translations',
  version: '1.0.0',
  setup(context, options: TranslationsOptions | undefined) {
    // Once per dictionary: check the options, prepare lookups.
    const zones = options?.zones ?? ['trn'];
    if (!Array.isArray(zones)) {
      throw new DslError('DSL0001', 'The zones option must be an array of tag names.');
    }
    // Once per entry, synchronously: exactly one result.
    return (entry): TranslationsResult => {
      const text = zoneText(entry.body, { zones, headwords: entry.headwords });
      if (text.length === 0) {
        context.diagnostics.report(
          createPluginDiagnostic('translations', 'The entry has no translation.', {
            code: 'translations/none',
            severity: 'info',
            position: entry.position,
          }),
        );
      }
      return {
        headword: entry.headwords[0]?.text ?? '',
        translations: text.length === 0 ? [] : text.split('\n'),
      };
    };
  },
});

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn]
dog
\t[m1]see <<hound>>
`;
const dict = parseDsl(text);
for await (const result of dict.entries({ plugin: translations })) console.log(result);
// { headword: 'cat', translations: [ 'Katze' ] }
// { headword: 'dog', translations: [] }
console.log(dict.diagnostics.map((d) => `${d.code} ${d.source} ${d.message}`));
// [ 'translations/none translations translations: The entry has no translation.' ]
```

### `DictionaryContext`

What `setup` receives, prepared before it and read-only:

| Field            | Meaning |
| ---------------- | ------- |
| `header`         | The `DslHeader`: `directives`, `name`, `indexLanguage`, `contentsLanguage`, and the resolved languages `indexLanguageInfo`, `contentsLanguageInfo`. |
| `astVersion`     | `AST_VERSION` of the entries. |
| `packageVersion` | The version of dsl-dicts. |
| `diagnostics`    | Where to report problems (see [Diagnostics of a plugin](#diagnostics-of-a-plugin)). |
| `abbreviations`  | The expansions of `[p]` labels, from `_abrv.dsl`: label to expansion, keys normalized with `normalizeLabel`. Absent if nobody read the file. |
| `annotation`     | The `.ann` annotation: `{ sections, text }`, each section with its language. Absent if not read. |
| `info`           | How the dictionary was decoded (`DecodeInfo`), when it is known as the plugin is set up; for a file of pure ASCII it is only known at the end, and absent. |
| `files`          | The paths of the dictionary and its companion files, when it was opened with `openDsl`. |

`openDsl` fills `abbreviations`, `annotation` and `files` from the files next to the
dictionary; with `parseDsl`, pass the `abbreviations` and `annotation` options (see
`parseAbbreviations` and `parseAnnotation`).

## Using a plugin

- `dict.entries({ plugin, options })` yields one output per entry; `dict.batches({ plugin,
  options })` yields them in arrays. Like the plain forms, they read the dictionary once.
- `toJsonl(dict, { plugin, options })` and `toJson` export the outputs; the CLI takes a plugin
  with `--plugin`.
- `setupPlugin(plugin, context, options)` sets a plugin up by hand and returns its transform,
  with errors wrapped as below; `createDictionaryContext(init)` builds a context. That is the
  way to apply a plugin to entries of another origin, or to raw-mode entries whose body you
  parse yourself:

<!-- example: plugin-by-hand -->
```ts
import { createDictionaryContext, parseBody, parseDsl, setupPlugin } from 'dsl-dicts';
import { plainText } from 'dsl-dicts/plugins';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn]
dog
\t[m1][trn]Hund[/trn]
`;

// Raw mode: the headwords are parsed, the bodies are not, until needed.
const dict = parseDsl(text, { body: 'raw' });
const context = createDictionaryContext({ header: await dict.header });
const render = setupPlugin(plainText, context, { indent: '  ' });

for await (const entry of dict.entries()) {
  if (!entry.headwords.some((headword) => headword.variants.includes('dog'))) continue;
  console.log(render({ ...entry, body: parseBody(entry) })); // { headwords: [ 'dog' ], text: '  Hund' }
}
```

A plugin needs parsed bodies: passing one to a dictionary in raw mode throws `DSL0001`.

## Errors

Errors of a plugin reach the caller as a `DslError` whose `plugin` field names the plugin, from
the iteration (or from `setupPlugin`):

| Code      | When |
| --------- | ---- |
| `DSL0001` | The plugin itself is invalid (name, version, `setup`), or its `setup` threw a `DslError` `DSL0001`: the way to refuse invalid options. The message is prefixed with `name@version`. |
| `DSL5001` | `setup` threw anything else, or returned something other than a function. The original error is the `cause`. |
| `DSL5002` | The transform threw on an entry. The error has the entry's `position`; the original error is the `cause`. |

Any of them ends the iteration; the entries already yielded stay valid. The CLI exits with code
1 for `DSL0001` and 3 for `DSL5001` and `DSL5002`.

## Diagnostics of a plugin

A plugin reports problems through `context.diagnostics`; build the diagnostic with
`createPluginDiagnostic(plugin, message, { code, severity, position })`:

- `code` is namespaced by the plugin name, `<plugin-name>/<id>` (`translations/none`), so that
  codes of different plugins never collide with each other or with the catalog. Without a code,
  the diagnostic is `DSL5101`.
- `severity` is the plugin's choice; default `warning`.
- The message is prefixed with the plugin name, and `source` is set to it.

In `parseDsl`, these diagnostics are kept and counted with the dictionary's own (they appear in
`dict.diagnostics`, `diagnosticCounts()` and the JSONL summary), and strict mode applies to
them: one of the strict severity throws, and the transform's caller gets a `DSL5002` whose
`cause` is the strict-mode error. Set up by hand without a sink, reports are dropped.

## Asynchronous resources

`setup` is synchronous by design, so that the plugin is ready as soon as the header is. A
plugin that needs asynchronous resources, such as a word list or a model, is made by an
asynchronous factory that loads them first:

<!-- example: plugin-async-factory -->
```ts
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
```

## Versioning the output

`version` is the semantic version of what the transform returns:

- a change that can break a consumer of the output (a field removed or changing meaning) is a
  new major version;
- a new optional field is a minor version; a fix that keeps the shape is a patch.

Exports record it in their header (`plugin: { name, version }`), and `readJsonl` refuses a
document whose plugin has another major version than the one expected (and, for `0.x`, another
minor version): see [jsonl.md](jsonl.md#versions-and-compatibility). A plugin built on the AST
should check `context.astVersion` if it depends on more than the current AST guarantees.

## Rendering helpers

The building blocks of the built-in plugins, exported from `dsl-dicts`:

| Helper | What it does |
| ------ | ------------ |
| `toPlainText(nodes, options)` | Renders nodes as a viewer shows them without styling: `~` substituted (from `headwords` or `tilde`), line breaks and `[m]` paragraphs as lines (indented by `indent` per level), runs of spaces collapsed. Options choose whether to include `[*]` secondary text, media file names, `[!trs]` text, `[p]` labels (expanded with `expandLabels` and `abbreviations`), sub-entries, and how to render `[']` stresses (`stress: 'combining'` adds U+0301). |
| `zoneText(nodes, options)` | The text of the search zones (by default `SEARCH_ZONES`: `trn`, `trn1`, `ex`, `com`), one line per zone, without `[!trs]`, media and labels. |
| `hasZones(nodes, zones?)` | Whether the nodes have a search zone. |
| `normalizeLabel(text)` | The key of a label in `abbreviations`: whitespace collapsed and trimmed. |
| `walk`, `walkEntry` | Depth-first traversal (see [ast.md](ast.md#walking-the-tree)). |

## `plain-text`

`plainText` (from `dsl-dicts/plugins`, version `1.0.0`) renders each entry as plain text.

Output, `PlainTextResult`: `{ headwords, text }`, where `headwords` are the headwords' `text`
and `text` is `toPlainText(entry.body)` with `~` substituted.

| Option         | Default | Meaning |
| -------------- | ------- | ------- |
| `indent`       | `''`    | Indentation per `[m]` level. |
| `secondary`    | `true`  | Include the secondary text of `[*]`. |
| `media`        | `false` | Include the file names of `[s]` and `[video]`. |
| `unindexed`    | `true`  | Include `[!trs]` text. |
| `labels`       | `true`  | Include `[p]` labels. |
| `expandLabels` | `false` | Replace labels by their expansion from the dictionary's abbreviations. |
| `subentries`   | `true`  | Include sub-entries: their headwords, one per line, then their content. |
| `stress`       | `'none'`| `'combining'` marks the letters of `[']` with U+0301. |

## `search-text`

`searchText` (from `dsl-dicts/plugins`, version `1.0.0`) extracts what a full-text search
should index.

Output, `SearchTextResult`: `{ forms, text }`. `forms` are the index forms (`variants`) of the
entry's headwords, then of its sub-entries' headwords, without duplicates. `text` has one line
per search zone (`zoneText`); a body without any zone falls back to its plain text, without
`[!trs]`, labels and media.

| Option         | Default          | Meaning |
| -------------- | ---------------- | ------- |
| `zones`        | `SEARCH_ZONES`   | The zone tags to index. |
| `fallback`     | `'plain-text'`   | The text of a body without zones; `'none'` for an empty text. |
| `labels`       | `false`          | Include `[p]` labels (Lingvo leaves them out of the index). |
| `expandLabels` | `false`          | Replace the included labels by their expansion. |
| `secondary`    | `true`           | Include `[*]` text. |
| `subentries`   | `true`           | Include sub-entries, their forms and their text. |

<!-- example: plugins-builtin -->
```ts
import { parseDsl } from 'dsl-dicts';
import { plainText, searchText } from 'dsl-dicts/plugins';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

colo(u)r
\t[m1][p]n[/p] [trn]Farbe[/trn] [com](of light)[/com]
\t[m2][ex][lang id=1033]a bright ~[/lang] — eine helle Farbe[/ex]
`;
const abbreviations = new Map([['n', 'noun']]);

const plain = parseDsl(text, { abbreviations });
for await (const result of plain.entries({
  plugin: plainText,
  options: { indent: '  ', expandLabels: true },
})) {
  console.log(result);
  // { headwords: [ 'colo(u)r' ], text: '  noun Farbe (of light)\n    a bright color — eine helle Farbe' }
}

for await (const result of parseDsl(text).entries({ plugin: searchText })) {
  console.log(result);
  // { forms: [ 'color', 'colour' ], text: 'Farbe\n(of light)\na bright color — eine helle Farbe' }
}
```

## `article` (experimental)

`article` (from `dsl-dicts/article`) reads each entry as a dictionary article: senses with
their numbers, labels, translations, examples, comments and links, plus transcriptions, media
and sub-entries. It is the successor of the output of dsl-dicts 1.x.

DSL describes the layout of a card, not its meaning, so this is a heuristic: it reads common
conventions (numbering `I`, `1.`, `1)`, `а)`; `[m]` levels; search zones; a dash between an
example and its translation), and may read an unusual dictionary poorly. The AST is the exact
representation. **The article format is experimental**: it may change in a minor version of
dsl-dicts. `ARTICLE_VERSION` (now `1.0.0`) is the plugin's `version`, recorded with exports.

<!-- example: article-basic -->
```ts
import { parseDsl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m0][t]kæt[/t]
\t[m1]1) [p]n[/p] [trn]Katze; Kater[/trn]
\t[m2][ex][lang id=1033]a black ~[/lang] — eine schwarze Katze[/ex]
\t[m1]2) [p]coll.[/p] [trn]Kerl[/trn] [com](a man)[/com]
`;
const abbreviations = new Map([
  ['n', 'noun'],
  ['coll.', 'colloquial'],
]);

for await (const entry of parseDsl(text, { abbreviations }).entries({ plugin: article })) {
  console.log(JSON.stringify(entry, null, 2));
}
```

prints:

<!-- block: article-basic-output -->
```json
{
  "kind": "zone-marked",
  "headwords": [{ "text": "cat", "variants": ["cat"] }],
  "transcriptions": ["kæt"],
  "media": [],
  "labels": [],
  "senses": [
    {
      "number": "1",
      "labels": [{ "text": "n", "expansion": "noun" }],
      "translations": ["Katze", "Kater"],
      "examples": [
        {
          "source": { "text": "a black cat", "language": "English" },
          "target": { "text": "eine schwarze Katze", "language": "German" }
        }
      ],
      "comments": [],
      "references": [],
      "senses": []
    },
    {
      "number": "2",
      "labels": [{ "text": "coll.", "expansion": "colloquial" }],
      "translations": ["Kerl"],
      "examples": [],
      "comments": ["a man"],
      "references": [],
      "senses": []
    }
  ],
  "references": [],
  "comments": [],
  "subentries": []
}
```

### The model

Plain data, JSON-serializable; optional fields are left out rather than `undefined`.

`Article`:

| Field            | Meaning |
| ---------------- | ------- |
| `kind`           | The shape of the entry, and the extractor that read it (see below). |
| `headwords`      | `{ text, variants }` of each headword. |
| `transcriptions` | `[t]` texts, or a bracketed `[...]` before the first sense, as written. |
| `media`          | Media files, wherever they are: `{ file, type, label? }`, `type` being `sound`, `image`, `video` or `other` by the extension. |
| `labels`         | Labels of the entry as a whole (before the first sense), such as the part of speech. |
| `senses`         | The senses, in order, nested by their numbering and `[m]` levels. |
| `references`     | Links of the entry as a whole. |
| `comments`       | Comments of the entry as a whole. |
| `subentries`     | The sub-entries, as articles of their own. |
| `notes`          | Text of the entry that is in no zone and could not be placed; absent if none. |

`Sense`: `number` (`1` for `1)` and `1.`, `а`, `II`; absent if unnumbered), `labels`,
`translations` (the `[trn]` text without labels and comments, split at semicolons outside
brackets), `examples`, `comments` (without enclosing parentheses), `references`, `senses`
(sub-senses) and `notes` (absent if none). Together with `Article.notes`, nothing of the body
is dropped silently but punctuation, numbering and whitespace.

`Example`: `source` and `target` (`{ text, language? }`, the target may be absent) and
`labels`. The source language comes from its `[lang]` tag or the dictionary's index language;
the target's is the contents language.

`Label`: `{ text, expansion? }`, the expansion from the dictionary's abbreviations.
`Reference`: `{ target, dictionary?, text?, label?, sense?, external? }`: `label` is what the
dictionary says the link means (`см.`, `Syn`), `sense` the sense number after it, `external`
an `[url]`.

`kind` is one of: `zone-marked` (the body marks translations, examples or comments with zones),
`layout-only` (paragraphs and numbering, no zones), `plain` (plain text lines),
`reference-only` (links, labels and comments only, such as "see <<other>>") and `media-only`.
The classifier `classifyBody` picks it; each kind has an extractor.

### Options

Given when the plugin is used: `entries({ plugin: article, options })`.

| Option              | Default  | Meaning |
| ------------------- | -------- | ------- |
| `labels`            | `true`   | Include labels (`Article.labels`, `Sense.labels`, `Example.labels`, `Media.label`). Off, they are still recognized, so their text never ends up in translations. |
| `expandLabels`      | `true`   | Give labels their `expansion` from the dictionary's abbreviations, when there are some. |
| `stress`            | `'none'` | `'combining'` marks the stressed letters of `[']` with U+0301. |
| `secondary`         | `true`   | Include the secondary content of `[*]`, where many examples and links are. |
| `splitTranslations` | `true`   | Split translations at semicolons outside brackets. |
| `kind`              | -        | Read every entry with this extractor instead of the one the classifier picks. |

### Customization

`createArticlePlugin(config)` makes an article plugin with a classifier and extractors of your
own, typically a profile for a family of dictionaries whose markup the built-in reading gets
wrong:

| Config       | Default             | Meaning |
| ------------ | ------------------- | ------- |
| `name`       | `'article'`         | The plugin name; give another to tell a customized plugin apart in exports. |
| `version`    | `ARTICLE_VERSION`   | The version of its output format; a plugin whose output differs should have its own. |
| `classify`   | `classifyBody`      | `(body, context) => kind`: picks the extractor of each entry and sub-entry. |
| `extractors` | `DEFAULT_EXTRACTORS`| Extractors by kind, added to the built-in ones or replacing them. |

An `Extractor` is `(body, context) => ArticleContent`: the article without `kind`, `headwords`
and `subentries`, which the plugin adds. Both receive an `ExtractionContext`: the plugin's
`dictionary` context, the resolved `options`, the `headwords` of the article being built, and
the `tilde` text. The built-in extractors (`extractZoneMarked`, `extractLayoutOnly`,
`extractPlain`, `extractReferenceOnly`, `extractMediaOnly`) can be called from yours.

<!-- example: article-custom -->
```ts
import { parseDsl } from 'dsl-dicts';
import {
  type Article,
  classifyBody,
  createArticlePlugin,
  extractZoneMarked,
} from 'dsl-dicts/article';

// A profile for a family of dictionaries that the built-in extractors read poorly.
const myArticle = createArticlePlugin({
  name: 'my-article',
  version: '1.0.0',
  extractors: {
    // Starts from the built-in reading and drops the text it could not place.
    'my-family': (body, context) => ({ ...extractZoneMarked(body, context), notes: [] }),
  },
  classify: (body, context) =>
    context.dictionary.header.name?.startsWith('Tiny ') ? 'my-family' : classifyBody(body, context),
});

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn] (rarely used)
`;
const articles: Article[] = [];
for await (const entry of parseDsl(text).entries({ plugin: myArticle })) articles.push(entry);
console.log(articles.map(({ kind, senses, notes }) => ({ kind, senses: senses.length, notes })));
// [ { kind: 'my-family', senses: 1, notes: undefined } ]
```
