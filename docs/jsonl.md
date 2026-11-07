# JSONL and JSON export

A library call gives JavaScript objects; JSONL is how dsl-dicts stores and exchanges them.
Dictionaries can have hundreds of thousands of entries, and one JSON document has to be held
whole to be read: JSONL is written and read line by line, one entry per line, in constant
memory, and works with `jq`, `grep`, database loaders and parallel processing.

- [Records](#records)
- [Versions and compatibility](#versions-and-compatibility)
- [Writing](#writing)
- [Reading](#reading)
- [JSON](#json)

## Records

A document is a sequence of JSON records, one per line, each ending with `\n`, each with a
`type`, so that any line can be filtered without context:

1. a `header` record, always first;
2. one `entry` record per entry, in order;
3. optionally, a `summary` record, always last. A document without one may have been cut short.

The `plain-text` export of a dictionary of two entries, with a summary (the second entry has an
unclosed `[b]`, `DSL4202`):

<!-- generated: jsonl-sample -->
```jsonl
{"type":"header","format":"dsl-dicts/jsonl","formatVersion":1,"generator":{"name":"dsl-dicts","version":"2.0.0"},"astVersion":1,"plugin":{"name":"plain-text","version":"1.0.0"},"dictionary":{"name":"Tiny English-German","indexLanguage":"English","contentsLanguage":"German"},"decode":{"encoding":"utf-16le","source":"bom","compression":"none"}}
{"type":"entry","data":{"headwords":["cat"],"text":"Katze"}}
{"type":"entry","data":{"headwords":["dog"],"text":"Hund"}}
{"type":"summary","entries":2,"diagnostics":{"DSL4202":1}}
```
<!-- end: jsonl-sample -->

### `header`

| Field                        | Meaning |
| ---------------------------- | ------- |
| `type`                       | `"header"`. |
| `format`                     | `"dsl-dicts/jsonl"` (`JSONL_FORMAT`). |
| `formatVersion`              | The version of the envelope: an integer, currently `1` (`JSONL_FORMAT_VERSION`). |
| `generator`                  | `{ name: "dsl-dicts", version }`: who wrote the document. |
| `astVersion`                 | `AST_VERSION` of the entries the document was made from. |
| `plugin`                     | `{ name, version }` of the plugin whose output the entries are, or `null` for AST entries. |
| `dictionary`                 | `{ name, indexLanguage, contentsLanguage }`: the `#NAME`, `#INDEX_LANGUAGE` and `#CONTENTS_LANGUAGE` values as written, `null` when missing. |
| `decode`                     | `{ encoding, source, compression }`: the WHATWG encoding name, how it was chosen (`bom`, `heuristic`, `utf8-detect`, `directive`, `default`, `option`, `string`) and `gzip` or `none`. |

### `entry`

`{ "type": "entry", "data": ... }`. The payload is in `data`, never spread into the record, so
that it cannot collide with the envelope and may be any JSON value. Without a plugin it is the
`DslEntry` (with positions unless they were switched off; the `cause` of its diagnostics, an
error object, is left out). With a plugin it is what the plugin returned for the entry.

### `summary`

| Field         | Meaning |
| ------------- | ------- |
| `type`        | `"summary"`. |
| `entries`     | The number of entry records. |
| `diagnostics` | How many diagnostics of each code were reported, in code order: all of them, of every layer and of the plugin, codes of plugins included. |

## Versions and compatibility

Three versions evolve independently:

| Version          | Of                                                                  | Form |
| ---------------- | ------------------------------------------------------------------- | ---- |
| `formatVersion`  | the envelope: record types, the fields of the header and summary   | an integer, a major version |
| `astVersion`     | the AST: the payload without a plugin, and the input of every plugin | an integer, a major version |
| `plugin.version` | the plugin's output format                                          | a semantic version |

Each follows the same rule: an incompatible change is a new major version (a new integer);
adding optional fields is compatible and changes nothing (for a plugin, a minor version). So a
reader:

- checks `format` and the major versions it depends on, and refuses what it does not know;
- ignores fields it does not know, in every record and in the payload;
- skips records of types it does not know: a later compatible version of the envelope may add
  some.

`generator.version` is informational: it does not decide compatibility.

## Writing

`toJsonl(dict, options)` returns an async iterable of lines, produced as the dictionary is
read. The options are `summary` (add the summary record) and, for a plugin's output, `plugin`
and its `options`. The header needs the encoding, which for a file of pure ASCII is only known
at its end, so that file is read before the first line. A dictionary in raw mode cannot be
exported (`DSL0001`), an output that is not JSON fails the export with `DSL7006`, and errors of
reading, strict mode and plugins end the iteration after the records already produced.

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

The CLI writes the same documents (`dsl-dicts convert`, see [cli.md](cli.md)), and
`createJsonlHeader` builds a header record for a writer of your own.

## Reading

`readJsonl(text, expect)` reads a document from an iterable or async iterable of strings in any
chunks (lines, or the pieces of a stream: a record may span chunks). It reads and checks the
header before it resolves, and returns `{ header, records }`; `records` yields the `entry` and
`summary` records as they are read, and can be iterated once. `parseJsonlHeader(line, expect)`
checks a header line alone.

Always checked, with the errors they throw:

| Code      | When |
| --------- | ---- |
| `DSL7001` | The document is empty, or its first record is not a valid header of format `dsl-dicts/jsonl`. |
| `DSL7002` | `formatVersion` is not the one this version of dsl-dicts reads. |
| `DSL7005` | While iterating: a record that is not valid JSON, not an object or without a `type`, an `entry` without `data`, a malformed `summary`, a second header. Blank lines are ignored. |

Checked if requested in `expect`:

| Expectation              | Code      | Meaning |
| ------------------------ | --------- | ------- |
| `astVersion: n`          | `DSL7003` | The document's `astVersion` must be `n`. |
| `plugin: { name }`       | `DSL7004` | The entries must be the output of that plugin. |
| `plugin: { name, version }` | `DSL7004` | ... with a compatible version: the same major version (for `0.x`, the same minor version too). |
| `plugin: null`           | `DSL7004` | The entries must be AST entries (no plugin). |

The payload is not checked: `readJsonl<T>()` asserts its type, after `expect` has checked the
plugin.

<!-- example: jsonl-read -->
```ts
import { createReadStream } from 'node:fs';
import { AST_VERSION, DslError, readJsonl } from 'dsl-dicts';
import { type Article, article } from 'dsl-dicts/article';

try {
  const { header, records } = await readJsonl<Article>(
    createReadStream('en-de.article.jsonl', 'utf8'),
    // Refuse a document this code does not understand.
    { astVersion: AST_VERSION, plugin: { name: article.name, version: article.version } },
  );
  console.log(header.dictionary.name, header.plugin); // Tiny English-German { name: 'article', ... }
  for await (const record of records) {
    if (record.type === 'entry') console.log(record.data.headwords[0]?.text);
    else console.log(`${record.entries} entries`, record.diagnostics);
  }
} catch (error) {
  // DSL7001-DSL7005: not a dsl-dicts document, or a version this code cannot read.
  if (error instanceof DslError && error.code.startsWith('DSL700')) console.error(error.message);
  else throw error;
}
```

## JSON

`toJson(dict, options)` writes one document, `{ "header": ..., "entries": [...], "summary":
... }`: `header` and `summary` are the records above (with their `type`), `entries` lists the
payloads, and `summary` is there if requested. `pretty: true` indents it. It streams too, but a
JSON document can only be read as a whole, so prefer JSONL for large dictionaries. There is no
reader for it: it is plain JSON.

<!-- example: jsonl-json -->
```ts
import { toJson } from 'dsl-dicts';
import { openDsl } from 'dsl-dicts/node';
import { plainText } from 'dsl-dicts/plugins';

// One JSON document, { header, entries, summary }, for a small dictionary.
const dict = await openDsl('dictionaries/en-de.dsl.dz');
let json = '';
for await (const chunk of toJson(dict, { plugin: plainText, pretty: true })) json += chunk;
const { header, entries } = JSON.parse(json);
console.log(header.plugin, entries.length); // { name: 'plain-text', version: '1.0.0' } 2
```
