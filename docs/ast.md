# The AST

What `parseDsl` gives for each entry of a dictionary, and what every plugin reads: a
`DslEntry` with parsed headwords and a tree of markup nodes. This is the stable contract of
dsl-dicts, versioned by `AST_VERSION` (currently `1`).

The AST is plain data: no classes, methods, cycles or shared mutable objects. Every entry is a
fresh object, JSON-serializable and safe to `structuredClone` or post to a worker. Nodes are
discriminated by `type`. Escapes are resolved, but nothing is substituted that the parser
cannot know: `~` stays a `tilde` node and links keep their target as written.

- [A sample](#a-sample)
- [`DslEntry`](#dslentry)
- [Positions](#positions)
- [Headwords](#headwords)
- [Nodes](#nodes)
- [Walking the tree](#walking-the-tree)
- [Evolution policy](#evolution-policy)

## A sample

This dictionary has one entry, with an unsortable part in its headword, a label, a translation
zone, a link and a sub-entry:

<!-- generated: ast-sample-dsl -->
```text
#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

{to }walk
	[m1][p]v[/p] [trn]gehen[/trn]
	see <<run>>
	@ ~ out
	[m1][trn]hinausgehen[/trn]
	@
```
<!-- end: ast-sample-dsl -->

Parsed with `positions: false`, its entry is:

<!-- generated: ast-sample-json -->
```json
{
  "headwords": [
    {
      "raw": "{to }walk",
      "display": [{ "type": "text", "text": "to walk" }],
      "text": "to walk",
      "variants": ["walk"]
    }
  ],
  "body": [
    {
      "type": "tag",
      "name": "m",
      "attrs": { "level": 1 },
      "children": [
        {
          "type": "tag",
          "name": "p",
          "attrs": {},
          "children": [{ "type": "text", "text": "v" }]
        },
        { "type": "text", "text": " " },
        {
          "type": "tag",
          "name": "trn",
          "attrs": {},
          "children": [{ "type": "text", "text": "gehen" }]
        },
        { "type": "lineBreak", "origin": "line" },
        { "type": "text", "text": "see " },
        { "type": "link", "children": [{ "type": "text", "text": "run" }] },
        {
          "type": "subentry",
          "headwords": [
            {
              "raw": "~ out",
              "display": [
                { "type": "tilde", "flipCase": false },
                { "type": "text", "text": " out" }
              ],
              "text": "walk out",
              "variants": ["walk out"]
            }
          ],
          "children": [
            {
              "type": "tag",
              "name": "m",
              "attrs": { "level": 1 },
              "children": [
                {
                  "type": "tag",
                  "name": "trn",
                  "attrs": {},
                  "children": [{ "type": "text", "text": "hinausgehen" }]
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "position": { "offset": 83, "line": 5, "column": 1 },
  "end": { "offset": 176, "line": 10, "column": 3 }
}
```
<!-- end: ast-sample-json -->

Note what the parser does and does not do: the braces of `{to }walk` are gone from `display`
but their content is kept, and `variants` has only the sortable part; the second body line is
separated from the first by a `lineBreak`; the sub-entry is inside the `[m1]` tag that is open
where it occurs; the `~` of its headword is a `tilde` node in `display` and is substituted in
`text` and `variants`.

## `DslEntry`

| Field         | Type                     | Meaning                                                                                       |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `headwords`   | `readonly Headword[]`    | The headwords, at least one, in order. Consecutive headword lines share one body.            |
| `body`        | `readonly MarkupNode[]`  | The body. In raw mode (`body: 'raw'`), the raw body lines (`BodyLine[]`) instead.            |
| `position`    | `SourcePosition`         | Position of the first headword line.                                                          |
| `end`         | `SourcePosition`         | Position just after the last character of the entry's last line.                             |
| `diagnostics` | `readonly Diagnostic[]?` | The diagnostics of its headwords and body (`DSL3xxx`, `DSL4xxx`), in source order; absent if none. |

In raw mode the body is not parsed; `parseBody(entry)` parses it on demand, with the same
result as the default mode. `ParsedDsl.bodyMode` tells which mode a dictionary was parsed in.

## Positions

Entries, headwords, nodes, directives and diagnostics locate themselves with `position` (the
first character) and `end` (just after the last one), both `SourcePosition`:

| Field    | Meaning                                                                                |
| -------- | -------------------------------------------------------------------------------------- |
| `offset` | Zero-based offset into the decoded text, in UTF-16 code units, after newline normalization. |
| `line`   | One-based line number.                                                                 |
| `column` | One-based column, in UTF-16 code units (a tab is one column).                          |

Newlines are normalized (`\r\n` and `\r` become `\n`) before anything else. Offsets refer to
the normalized text; line and column numbers are the same in the original file. For an
implicitly closed tag, `end` is where it was closed.

`parseMarkup('[b]walk[/b]')` gives:

<!-- generated: ast-positions -->
```json
[
  {
    "type": "tag",
    "name": "b",
    "attrs": {},
    "children": [
      {
        "type": "text",
        "text": "walk",
        "position": { "offset": 3, "line": 1, "column": 4 },
        "end": { "offset": 7, "line": 1, "column": 8 }
      }
    ],
    "position": { "offset": 0, "line": 1, "column": 1 },
    "end": { "offset": 11, "line": 1, "column": 12 }
  }
]
```
<!-- end: ast-positions -->

`positions: false` (an option of `parseDsl`, `parseBody`, `parseMarkup` and `parseHeadword`)
leaves `position` and `end` out of headwords and nodes, which saves memory and time. Entries,
directives and diagnostics always have theirs.

## Headwords

A `Headword` is a headword of an entry, or of a sub-entry:

| Field      | Meaning                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `raw`      | The headword as written, comments removed, without leading and trailing spaces and tabs (an escaped trailing space is kept).            |
| `display`  | What the card title shows, as markup nodes: braces removed and their content kept, parentheses kept as text, escapes resolved, `~` a `tilde` node. |
| `text`     | The plain text of `display`: tags dropped, `~` substituted, `[br]` as a space, runs of spaces and tabs collapsed, trimmed.                |
| `variants` | The index forms: what the headword is listed, sorted and searched under.                                                                   |
| `position`, `end` | Where `raw` is in the source, unless positions are off.                                                                           |

The syntax, from the DSL manual, with GoldenDict's behaviour where the manual is silent:

- `(...)` is an optional part: the headword has a form with it and one without it. Groups may
  follow each other and nest.
- `{...}` is the unsortable part: shown, but part of no index form. Tags are only allowed there
  (`{[']}a{[/']}rt` stresses the `a`); a tag outside braces is parsed all the same, its text is
  sortable, and `DSL3101` is reported.
- `\x` makes any character literal, `\(`, `\{` and `\~` included. An escaped space is U+00A0 in
  `display` and `text`, and a plain space in `variants`, as in GoldenDict.
- `~` stands for the first index form of the entry's first headword: in a sub-entry's headwords,
  and in an entry's headwords after the first. `^~` is the same with the case of its first
  character flipped. In an entry's first headword, `~` has nothing to stand for and is kept as
  `~` (`DSL3102`).

`variants` lists every combination of the optional parts, in a deterministic order: each part
left out before it is included, the leftmost part varying slowest. The forms have no unsortable
part and no tags, spaces and tabs are collapsed and trimmed, and empty forms and duplicates are
removed. Examples:

<!-- generated: headwords -->
| Written | `text` | `variants` |
| --- | --- | --- |
| `colo(u)r(s)` | `colo(u)r(s)` | `color`, `colors`, `colour`, `colours` |
| `(un)lock(ed)` | `(un)lock(ed)` | `lock`, `locked`, `unlock`, `unlocked` |
| `a(b(c))d` | `a(b(c))d` | `ad`, `abd`, `abcd` |
| `{to }walk` | `to walk` | `walk` |
| `{[']}a{[/']}rt` | `art` | `art` |
| `walk\ in` | `walk\u00a0in` | `walk in` |
| `\(not\) optional` | `(not) optional` | `(not) optional` |
<!-- end: headwords -->

Limits, against pathological input: a headword whose sortable text is longer than 500
characters is not expanded (its only form keeps the parentheses as text, `DSL3202`), at most
256 forms are generated (`DSL3203`), and a headword with no sortable text has no forms at all
(`DSL3201`). Recovery from unbalanced braces and parentheses is described in
[dsl-format.md](dsl-format.md#headwords).

`parseHeadword` parses a single headword, for tools that read headwords from elsewhere:

<!-- example: ast-headword -->
```ts
import { parseHeadword } from 'dsl-dicts';

const headword = parseHeadword('{to }colo(u)r(s)', { positions: false });
console.log(headword.display); // [ { type: 'text', text: 'to colo(u)r(s)' } ]
console.log(headword.text); // 'to colo(u)r(s)'
console.log(headword.variants); // [ 'color', 'colors', 'colour', 'colours' ]
```

## Nodes

`MarkupNode` is the union of six node types. Every node may have `position` and `end`.

### `text`

| Field  | Meaning |
| ------ | ------- |
| `text` | The text, escapes resolved: `\[` and `[[` are `[`, an escaped space is U+00A0 (a plain space inside `[s]` and `[video]`). Never empty, never contains a newline. Adjacent text is always one node. |

### `tag`

A tag and its content: `[b]...[/b]`, `[m2]...`, `[lang id=1033]...[/lang]`. Every tag is a
`tag` node, whatever its name, so a tag the parser does not know does not change the schema.

| Field      | Meaning |
| ---------- | ------- |
| `name`     | The registry name: `b`, `c`, `trn`, `!trs`, `'`, `*`; `m` for `[m]` and `[m0]`..`[m9]`. An unknown tag keeps its name as written, case included. |
| `attrs`    | The parsed attributes (`TagAttributes`); `{}` if none. |
| `rawAttrs` | The attribute text as written, between the name and the `]`, trimmed, escapes unresolved; absent if empty. An unknown tag has only this. |
| `children` | The content, in order; may be empty. |

`TagAttributes` has only the fields that apply to the tag:

| Field        | Tag                             | Meaning |
| ------------ | ------------------------------- | ------- |
| `level`      | `[m]`, `[m0]`..`[m9]`           | The margin level; 0 for a bare `[m]`. |
| `color`      | `[c name]`                      | The color name; absent for a bare `[c]` (the viewer's default color). |
| `languageId` | `[lang id=1033]`                | A Windows LCID or a legacy Lingvo id (1-30); resolve it with `findLanguageById`. |
| `language`   | `[lang name="English"]`         | A Lingvo language name as written; resolve it with `resolveLanguageName`. |
| `dict`       | `[ref dict="..."]`              | The dictionary the link points to. |
| `target`     | `[ref target="..."]`, `[url target="..."]` | The link target (undocumented by Lingvo). |

Values are kept even when they are unknown (a color, a language), with a diagnostic.

`[m]` tags are block-level: they are always children of the body or of a sub-entry, never of
another tag. `getTagSpec(name)` describes a tag (kind, attributes, where it is allowed); the
registry is experimental and may gain fields. The tags are listed in
[dsl-format.md](dsl-format.md#tags).

### `lineBreak`

| Field    | Meaning |
| -------- | ------- |
| `origin` | `line`: between two body lines; `tag`: a `[br]`. |

There is no `line` break before the first content of the body or of a sub-entry, after the
last, around a sub-entry, or before an `[m]` tag, which starts a new paragraph by itself.

### `link`

A `<<target>>` link to another entry of the same dictionary.

| Field      | Meaning |
| ---------- | ------- |
| `children` | The target as written: `text` and `tilde` nodes only. Markup inside a link is kept as text. |

`[ref]` and `[url]` links are `tag` nodes; their content is text only, too.

### `tilde`

`~`, the entry's headword. Projections substitute it: `toPlainText` with the entry's
`headwords` uses the first index form of the first headword.

| Field      | Meaning |
| ---------- | ------- |
| `flipCase` | `^~`: the case of the first character is flipped. |

### `subentry`

A sub-entry, `@ headword` ... `@`, at the place it occurs in the parent's markup: inside the
tags open at that point, typically an `[m]` tag.

| Field       | Meaning |
| ----------- | ------- |
| `headwords` | The headwords, one per `@ headword` line, at least one. A `~` in them is the parent entry's headword. |
| `children`  | The content, from the line after the headwords to the closing `@`. |

### Helpers

`isParentNode(node)` tells whether a node has `children` (`tag`, `link`, `subentry`).
`ParentNode` is that union.

## Walking the tree

`walk(nodes, visitor)` visits nodes depth first, in document order. The visitor is a function
(called before the children) or an object with `enter` and `leave`; it receives the node, its
parent (`undefined` at the top level) and its index, and may return `'skip'` (from `enter`: not
the children) or `'stop'`. `walk` does not visit headwords; `walkEntry(entry, visitor)` visits
the `display` nodes of the entry's headwords first, and those of each sub-entry's headwords
before its children.

<!-- example: ast-walk-entry -->
```ts
import { type DslEntry, getTagSpec, walkEntry } from 'dsl-dicts';

/** The links of an entry: `<<target>>` and `[ref]`, with their target text. */
export function linksOf(entry: DslEntry): string[] {
  const links: string[] = [];
  walkEntry(entry, (node) => {
    if (node.type === 'link' || (node.type === 'tag' && getTagSpec(node.name)?.kind === 'link')) {
      const parts = node.children.map((child) => (child.type === 'text' ? child.text : '~'));
      links.push(parts.join(''));
      return 'skip'; // the target is the whole content
    }
    return undefined;
  });
  return links;
}
```

`toPlainText`, `zoneText` and `hasZones` render nodes as text (see
[plugins.md](plugins.md#rendering-helpers)).

## Evolution policy

- **Consumers must ignore node types, fields and attribute keys they do not know.** A minor
  version of dsl-dicts may add node types, fields and attribute keys. Tags never change the
  schema: a new or unknown tag is a `tag` node with its name.
- Removing a node type or a field, or changing what one means, is a major version of dsl-dicts
  and a new `AST_VERSION`. Adding things does not change `AST_VERSION`.
- `DslEntry`, `Headword` and `SourcePosition` are part of the same contract. The `message` of a
  diagnostic is not.
- Exports record the AST version (`astVersion` in the JSONL header), so stored data can be
  checked against the version that reads it.

In TypeScript, a `switch` over `node.type` should have a `default` branch that skips what it
does not know, even if the compiler considers it unreachable today:

<!-- example: ast-html -->
```ts
import type { MarkupNode } from 'dsl-dicts';

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Renders markup as simple HTML. `tilde` is the headword the entry gives for `~`. */
export function toHtml(nodes: readonly MarkupNode[], tilde: string): string {
  let html = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        html += escapeHtml(node.text);
        break;
      case 'tilde':
        html += escapeHtml(tilde);
        break;
      case 'lineBreak':
        html += '<br>';
        break;
      case 'link':
        html += `<a class="entry">${toHtml(node.children, tilde)}</a>`;
        break;
      case 'subentry':
        html += `<div class="subentry">${toHtml(node.children, tilde)}</div>`;
        break;
      case 'tag': {
        const inner = toHtml(node.children, tilde);
        if (node.name === 'b' || node.name === 'i' || node.name === 'u') {
          html += `<${node.name}>${inner}</${node.name}>`;
        } else if (node.name === 'm') {
          html += `<p class="m${node.attrs.level ?? 0}">${inner}</p>`;
        } else if (node.name !== 's' && node.name !== 'video') {
          html += inner; // any other tag, known or not: its content
        }
        break;
      }
      default:
        // A node type added in a later minor version: skip it.
        break;
    }
  }
  return html;
}
```
