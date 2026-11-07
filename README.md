# dsl-dicts

A parser for ABBYY Lingvo DSL dictionaries (`.dsl`, `.dsl.dz`) for Node.js and browsers,
written in TypeScript, with no runtime dependencies.

It reads a dictionary as a stream into a lossless markup tree (the AST), and turns the entries
into plain text, search text or structured articles through plugins. It exports dictionaries to
JSONL or JSON, and comes with a command line tool.

- Any size, in constant memory: `.dsl` files and their dictzip `.dsl.dz` form are read as a
  stream, entry by entry.
- Encodings detected: UTF-16 with or without a BOM, UTF-8, and 8-bit code pages
  (`#SOURCE_CODE_PAGE`); or forced by an option.
- The whole format: headword expansion (`colo(u)r`, `{to }walk`), escapes, `~`, comments,
  sub-entries, every tag of the DSL manual.
- Tolerant of the broken markup of real dictionaries, the way GoldenDict is: every recovery is
  a diagnostic with a stable code, and a strict mode turns them into errors.
- Plugins: plain text, search text, structured articles (experimental), or your own.
- Exports to JSONL with a versioned envelope, and a `dsl-dicts` CLI.

Upgrading from 1.x? See [MIGRATION.md][migration].

## Install

```sh
npm install dsl-dicts
```

## Requirements

- **Node.js 22.12 or later.** The package is ESM only; `require('dsl-dicts')` also works, through
  Node's `require(esm)`.
- **Browsers:** the core needs web APIs only: `TextDecoder`, `ReadableStream` and, for `.dz`
  files, `DecompressionStream`. TypeScript types are included.

| Entry point         | What it has                                                   | Runs in          |
| ------------------- | ------------------------------------------------------------- | ---------------- |
| `dsl-dicts`         | `parseDsl`, the AST, diagnostics, rendering helpers, JSONL    | Node.js, browser |
| `dsl-dicts/plugins` | the `plainText` and `searchText` plugins                      | Node.js, browser |
| `dsl-dicts/article` | the `article` plugin (experimental)                           | Node.js, browser |
| `dsl-dicts/node`    | `openDsl` (a file and its companion files), `findDictionaries` | Node.js          |
| `dsl-dicts` (bin)   | the command line tool                                         | Node.js          |

## Quick start

### Node.js

`openDsl` opens a file and the companion files next to it: the abbreviations of `[p]` labels
(`_abrv.dsl`) and the annotation (`.ann`).

<!-- example: readme-node -->
```ts
import { article } from 'dsl-dicts/article';
import { openDsl } from 'dsl-dicts/node';

// A .dsl or .dsl.dz file; its companion files (_abrv.dsl, .ann) are found next to it.
const dict = await openDsl('dictionaries/en-de.dsl.dz');
const header = await dict.header;
console.log(`${header.name}: ${header.indexLanguage} -> ${header.contentsLanguage}`);

for await (const entry of dict.entries({ plugin: article })) {
  const headwords = entry.headwords.map((headword) => headword.text).join(', ');
  const translations = entry.senses.flatMap((sense) => sense.translations).join('; ');
  console.log(`${headwords}: ${translations}`);
}
```

<!-- block: readme-node-output -->
```text
Tiny English-German: English -> German
cat: Katze; Kerl; Typ
colo(u)r: Farbe
```

### Browser

`parseDsl` reads a `File` or a `Blob` as a stream, and also takes a `Uint8Array`, an
`ArrayBuffer`, a `ReadableStream` (such as `fetch(url).body`), an async iterable of byte chunks,
or a string of decoded text.

<!-- example: readme-browser -->
```ts
import { parseDsl } from 'dsl-dicts';
import { plainText } from 'dsl-dicts/plugins';

/** Lists the entries of a dictionary file as plain text: one string per entry. */
export async function listEntries(file: Blob): Promise<string[]> {
  const lines: string[] = [];
  for await (const { headwords, text } of parseDsl(file).entries({ plugin: plainText })) {
    lines.push(`${headwords.join(', ')}\n${text}`);
  }
  return lines;
}

// With <input type="file" accept=".dsl,.dz">:
// input.addEventListener('change', async () => console.log(await listEntries(input.files[0])));
```

## Core concepts

**The pipeline.** Bytes are decompressed and decoded (`decodeDsl`), split into the header and
entries with comments removed (`segmentDsl`), and each entry's headwords and body are parsed
(`parseHeadwords`, `parseBody`). `parseDsl` runs all of it, lazily: input is read as entries are
requested. Every layer is public, for tools that need only part of it.

**The AST.** Each entry is a plain, JSON-serializable object, a `DslEntry`:

- `headwords`: what the entry is listed under. A `Headword` has the text as written (`raw`), as
  shown (`display` nodes, and `text`), and its index forms (`variants`): `colo(u)r` is shown as
  `colo(u)r` and found under `color` and `colour`.
- `body`: the markup, as a tree of nodes: `text`, `tag` (any tag: `[b]`, `[m1]`, `[trn]`,
  `[lang id=1033]`...), `lineBreak`, `link` (`<<target>>`), `tilde` (`~`, the headword) and
  `subentry` (`@ headword` ... `@`).
- `position` and `end` in the source, and the entry's `diagnostics`, if any.

<!-- example: readme-ast -->
```ts
import { parseDsl, walk } from 'dsl-dicts';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

colo(u)r
\t[m1][p]n[/p] [trn]Farbe[/trn], see <<hue>>
`;

for await (const entry of parseDsl(text).entries()) {
  const [headword] = entry.headwords;
  console.log(headword?.text, headword?.variants); // colo(u)r [ 'color', 'colour' ]
  walk(entry.body, (node) => {
    if (node.type === 'tag') console.log('tag', node.name); // m, p, trn
    if (node.type === 'link') console.log('link', node.children); // [ { type: 'text', ... } ]
  });
}
```

The AST is exact and stable: it is the contract of the package ([docs/ast.md][ast]).

**Plugins** turn entries into something else. A plugin is a plain object passed to `entries()`,
`batches()` or `toJsonl()`; there is no registry. The built-in ones are written against the
public API, like yours:

| Plugin        | From                | Output per entry                                                     |
| ------------- | ------------------- | -------------------------------------------------------------------- |
| `plainText`   | `dsl-dicts/plugins` | `{ headwords, text }`: the entry as a viewer shows it, without styling |
| `searchText`  | `dsl-dicts/plugins` | `{ forms, text }`: index forms, and the text of the search zones      |
| `article`     | `dsl-dicts/article` | senses, translations, examples, labels, links, media (experimental)   |

DSL describes the layout of a card, not its meaning, so `article` is a heuristic reading, and
its format may still change in a minor version; the AST it reads does not. See
[docs/plugins.md][plugins].

## Encodings and compressed files

Unless told otherwise, the encoding is detected, in this order:

1. a byte order mark: UTF-8, UTF-16LE or UTF-16BE;
2. UTF-16 without a BOM, by the NUL bytes of its first 4 KiB;
3. UTF-8, if the bytes from the first non-ASCII byte on are valid UTF-8;
4. the code page of `#SOURCE_CODE_PAGE` (`Cyrillic`, `Latin`, `EasternEuropean`...);
5. `defaultEncoding`: `windows-1251` unless set, as in Lingvo.

The `encoding` option forces an encoding and skips all of that. `encoding` and `defaultEncoding`
take a Lingvo code page name or a WHATWG encoding label (`utf-16le`, `windows-1252`). Gzip and dictzip (`.dz`) input is
recognized by its content, whatever the file name (`decompress: 'auto'`). `await dict.info` tells
what was found.

<!-- example: readme-encodings -->
```ts
import { readFile } from 'node:fs/promises';
import { parseDsl } from 'dsl-dicts';

const bytes = await readFile('dictionaries/old-de.dsl');

// An 8-bit file without #SOURCE_CODE_PAGE: say which code page to fall back to.
const fallback = parseDsl(bytes, { defaultEncoding: 'Latin' });
console.log(await fallback.info); // { encoding: 'windows-1252', source: 'default', ... }

// Detection goes wrong: force the encoding (no BOM sniffing, heuristics or directive).
const forced = parseDsl(bytes, { encoding: 'windows-1252' });
console.log((await forced.info).source); // 'option'
```

Compiled Lingvo dictionaries (`.lsd`) are not DSL files: convert them to `.dsl` first with an
external tool such as [lsd2dsl](https://github.com/nongeneric/lsd2dsl). dsl-dicts does not read
`.lsd` files.

## Diagnostics and strict mode

Real dictionaries contain broken markup, so parsing is tolerant by default: problems are
recovered from, the way GoldenDict does where it has a rule, and reported as diagnostics, each
with a stable code (`DSL4202`), a severity (`error`, `warning`, `info`), an English message and
a position. They are on `dict.diagnostics` (the first 10 000, `diagnosticsLimit`), counted by
`dict.diagnosticCounts()`, attached to their entry (`entry.diagnostics`), and sent as they are
found to the `diagnostics` sink of the options.

With `strict: true` (the same as `'error'`), `'warning'` or `'info'`, the first diagnostic of
that severity or a more severe one stops reading with a `DslError` of the same code. Every error
of the package is a `DslError` with a `code`: invalid arguments are thrown by the call, problems
with the input reject the promise or the iteration that needs it.

<!-- example: readme-diagnostics -->
```ts
import { DslError, parseDsl } from 'dsl-dicts';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn] [b]never closed
`;

// Tolerant by default: problems become diagnostics, and parsing goes on.
const dict = parseDsl(text);
for await (const entry of dict.entries()) console.log(entry.headwords[0]?.text); // cat
for (const { code, severity, message, position } of dict.diagnostics) {
  console.log(`${position?.line}:${position?.column} ${severity} ${code} ${message}`);
}
console.log(dict.diagnosticCounts().byCode); // { DSL4202: 1 }

// Strict: the first diagnostic of that severity, or a worse one, stops reading.
try {
  for await (const entry of parseDsl(text, { strict: 'warning' }).entries()) {
    console.log(entry.headwords[0]?.text); // never reached
  }
} catch (error) {
  if (!(error instanceof DslError)) throw error;
  console.log(error.code, error.diagnostic?.position?.line); // DSL4202 6
}
```

Every code is listed in [docs/diagnostics.md][diagnostics]. Match on `code`: messages may change.

## Streaming and memory

- Reading is lazy: input is read as entries are requested, and only the current chunk of input
  (64 KiB by default) and the entries you keep are held. (Awaiting `info` before the entries
  reads ahead until the encoding is known: for a file of pure ASCII, that is the end.)
- `entries()` yields one entry at a time. `batches()` yields arrays of entries, as they come out
  of each chunk: the fastest way to read a whole dictionary.
- The entries can be read **once**: a second `entries()` or `batches()` throws `DSL0002`. Parse
  again to read again.
- `positions: false` leaves positions out of headwords and nodes, `body: 'raw'` leaves bodies
  unparsed (for `parseBody` on the entries you need): both make reading faster.
- The `signal` option (an `AbortSignal`) cancels reading; the iteration then rejects with
  `DSL0003`, whose `cause` is the abort reason. Leaving a `for await` loop early also stops
  reading and releases the input.

<!-- example: readme-streaming -->
```ts
import { parseDsl } from 'dsl-dicts';

/** Counts the entries of a dictionary of any size, in constant memory. */
export async function countEntries(file: Blob): Promise<number> {
  // Give up after a minute: the iteration then rejects with a DslError DSL0003.
  const dict = parseDsl(file, { positions: false, signal: AbortSignal.timeout(60_000) });
  let count = 0;
  for await (const batch of dict.batches()) count += batch.length;
  return count;
}
```

## JSONL export and the CLI

`toJsonl` turns a dictionary into lines of JSON as it reads it: a `header` record (format and
versions, plugin, dictionary, decoding), one `{"type":"entry","data":...}` record per entry, and
an optional `summary`. `readJsonl` reads it back and checks the versions; `toJson` writes one
JSON document instead. See [docs/jsonl.md][jsonl].

<!-- example: readme-jsonl -->
```ts
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { toJsonl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';
import { openDsl } from 'dsl-dicts/node';

const dict = await openDsl('dictionaries/en-de.dsl.dz');
const lines = toJsonl(dict, { plugin: article, summary: true });
await pipeline(Readable.from(lines), createWriteStream('en-de.article.jsonl'));
```

The `dsl-dicts` command does the same from the shell ([docs/cli.md][cli]):

```sh
# The AST of every entry, as JSONL on standard output
npx dsl-dicts convert en-de.dsl.dz > en-de.ast.jsonl

# Articles of every dictionary under dicts/, as out/<same subdirectory>/<name>.article.jsonl
npx dsl-dicts convert dicts/ --recursive --plugin article -o out/

# Header, encoding, companion files, entry count and diagnostics of a dictionary
npx dsl-dicts info en-de.dsl.dz
```

Exit codes are stable: 0 success, 1 usage error, 2 dictionary or I/O error (including strict
mode failures), 3 plugin error, 70 internal error.

## Writing a plugin

A plugin has a `name`, the semantic `version` of its output format, and a `setup` function,
called once per dictionary with a `DictionaryContext` (the header, the abbreviations, a
diagnostics sink...). `setup` checks the options and returns the function that turns each entry
into exactly one output.

<!-- example: readme-plugin -->
```ts
import { DslError, definePlugin, parseDsl, toPlainText } from 'dsl-dicts';

interface GlossaryOptions {
  /** Between the headwords and the text. Default `': '`. */
  readonly separator?: string;
}

/** One line per entry: the headwords, then the body as plain text. */
export const glossary = definePlugin({
  name: 'glossary',
  version: '1.0.0',
  setup(_context, options: GlossaryOptions | undefined) {
    const separator = options?.separator ?? ': ';
    if (typeof separator !== 'string') {
      throw new DslError('DSL0001', 'The separator option must be a string.');
    }
    return (entry) => {
      const text = toPlainText(entry.body, { headwords: entry.headwords });
      return `${entry.headwords.map((h) => h.text).join(', ')}${separator}${text.replaceAll('\n', ' ')}`;
    };
  },
});

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][p]n[/p] [trn]Katze[/trn]
`;
for await (const line of parseDsl(text).entries({
  plugin: glossary,
  options: { separator: ' = ' },
})) {
  console.log(line); // cat = n Katze
}
```

The contract, errors, custom diagnostics and the built-in plugins' options are in
[docs/plugins.md][plugins]; `toPlainText`, `zoneText` and `walk` are the helpers they use.

## Stability

dsl-dicts follows semantic versioning. Covered: the public API (every export of the four entry
points, as listed in `test/api/public-api.txt`), the AST, `DslEntry` and positions, the plugin
contract, the JSONL envelope, diagnostic codes and their severities, CLI options and exit codes.
Not covered: diagnostic messages, and what is marked experimental: the `dsl-dicts/article` plugin
and its output, and the tag registry (`getTagSpec`). Details in [STABILITY.md][stability].

## Documentation

- [docs/ast.md][ast]: the AST: entries, headwords, nodes, positions.
- [docs/plugins.md][plugins]: the plugin contract, the built-in plugins, the `article` model.
- [docs/jsonl.md][jsonl]: the JSONL and JSON export format and its versions.
- [docs/cli.md][cli]: the `dsl-dicts` command.
- [docs/diagnostics.md][diagnostics]: every diagnostic code.
- [docs/dsl-format.md][format]: the DSL format, as dsl-dicts reads it.
- [MIGRATION.md][migration]: from 1.x to 2.0. [CHANGELOG.md](CHANGELOG.md): the changes.

## License

[MIT](LICENSE)

[ast]: https://github.com/borshak/dsl-dicts/blob/master/docs/ast.md
[cli]: https://github.com/borshak/dsl-dicts/blob/master/docs/cli.md
[diagnostics]: https://github.com/borshak/dsl-dicts/blob/master/docs/diagnostics.md
[format]: https://github.com/borshak/dsl-dicts/blob/master/docs/dsl-format.md
[jsonl]: https://github.com/borshak/dsl-dicts/blob/master/docs/jsonl.md
[migration]: https://github.com/borshak/dsl-dicts/blob/master/MIGRATION.md
[plugins]: https://github.com/borshak/dsl-dicts/blob/master/docs/plugins.md
[stability]: https://github.com/borshak/dsl-dicts/blob/master/STABILITY.md
