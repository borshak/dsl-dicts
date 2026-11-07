# The DSL format, as dsl-dicts reads it

DSL (Dictionary Specification Language) is the source format of ABBYY Lingvo dictionaries, also
read by GoldenDict and other viewers. This is a practical summary of the format and of how
dsl-dicts reads it, including the leniencies real files need. The references are:

- the DSL manual: <https://anatoly.dev/dsl-manual/>, the most complete;
- the DSL Reference: <https://github.com/yozhic/DSL-Reference>.

Where they are silent or Lingvo would reject a file, dsl-dicts does what GoldenDict does, and
reports the problem as a diagnostic (codes in [diagnostics.md](diagnostics.md)).

- [Files](#files)
- [Header](#header)
- [Entries](#entries)
- [Comments](#comments)
- [Headwords](#headwords)
- [Body markup](#body-markup)
- [Sub-entries](#sub-entries)
- [Tags](#tags)
- [Recovery from malformed markup](#recovery-from-malformed-markup)
- [Not supported](#not-supported)

## Files

| File | What it is | dsl-dicts |
| ---- | ---------- | --------- |
| `name.dsl` | The dictionary. | `parseDsl`, `openDsl` |
| `name.dsl.dz` | The same, compressed with dictzip (valid gzip): the usual form for GoldenDict. | Detected by content (`decompress: 'auto'`); `.dsl.gz` works too. |
| `name_abrv.dsl` | Abbreviations: each entry a `[p]` label and its expansion. May have no header. | `parseAbbreviations`; found by `openDsl`. |
| `name.ann` | The annotation: plain text, in sections that start with `#LANGUAGE "Name"`. | `parseAnnotation`; found by `openDsl`. |
| `name.bmp` | The icon. | Reported by `openDsl` (`files.icon`). |
| `name.dsl.files.zip` | Media files for GoldenDict. | Reported by `openDsl` (`files.media`), not read. |

`openDsl` finds companion files by the dictionary's base name in any letter case.

Encodings: UTF-16LE with a BOM is the standard; UTF-16BE, UTF-8 and 8-bit code pages named by
`#SOURCE_CODE_PAGE` also occur. dsl-dicts recognizes UTF-8 without a BOM too, by its validity. See the
detection order in the [README](../README.md#encodings-and-compressed-files). Line ends may be
`\r\n`, `\n` or `\r`; they are normalized.

Compiled Lingvo dictionaries (`.lsd`) are a different, binary format: convert them to `.dsl`
with an external tool such as [lsd2dsl](https://github.com/nongeneric/lsd2dsl).

## Header

The file starts with directives, one per line: `#NAME "Tiny English-German"`.

- The name runs from the `#` up to the first space, tab or double quote; the value is the text
  between the first and the last double quote, as in GoldenDict. A value without two quotes is
  taken as is (`DSL2002`).
- `#NAME`, `#INDEX_LANGUAGE` (the language of the headwords) and `#CONTENTS_LANGUAGE` (of the
  bodies) are mandatory (`DSL2001` if missing).
- `#SOURCE_CODE_PAGE` names the 8-bit code page of a file without a BOM: `Cyrillic`, `Latin`,
  `EasternEuropean`, `Greek`, `Turkish`, `Baltic`, `Arabic` (and, unconfirmed, `Hebrew`,
  `Vietnamese`). Unknown names (`DSL1202`) and unusable ones (`DSL1203`) fall back to
  `defaultEncoding`. It is ignored when a BOM or UTF-16 is detected (`DSL1204`), or when the
  content is valid UTF-8 (`DSL1205`).
- Language names are Lingvo's, case-sensitive (`English`, `GermanNewSpelling`). They are
  resolved leniently, as GoldenDict does: in any case, and without an ending such as
  `ModernSort` (`DSL2007`, info); an unknown name is `DSL2005`. The result is in
  `header.indexLanguageInfo` and `contentsLanguageInfo`.
- `#INCLUDE`, `#ICON_FILE`, `#SOUND_DICTIONARY` are known and kept as directives; other
  directives are kept too (`DSL2004`, info). A repeated directive keeps its first value
  (`DSL2003`). All are in `header.directives`, in order.
- The header is the leading `#` lines, with blank lines allowed between them. A `#` line after
  it is ignored, wherever it is (`DSL2006`): a headword that starts with `#` is written `\#`.

## Entries

An entry (card) is one or more headword lines, then its body: the indented lines that follow.

```text
cat
kitten
	[m1][trn]Katze; Kätzchen[/trn]
dog
	[m1][trn]Hund[/trn]
```

- Spaces and tabs are the only whitespace: a line that starts with any other character
  (U+00A0 included) is a headword (or a directive). A blank line is empty or has only spaces
  and tabs.
- Consecutive headword lines share the body. Body lines lose their indentation.
- Blank lines between entries are normal. Blank lines between headwords, or between the
  headwords and the body, are skipped and the headwords merge (`DSL2202`; Lingvo rejects
  them). Blank lines inside a body are skipped and the body goes on (`DSL2203`).
- Indented lines before the first headword are ignored (`DSL2201`). Headwords at the end of the
  file without a body still make an entry, with an empty body (`DSL2204`).

## Comments

`{{` starts a comment and the next `}}` ends it, possibly on a later line. Comments are removed
before anything else is parsed.

- Nothing is special inside a comment, not even `\`: `{{a\}}` is a complete comment. Outside
  one, `\{{` is a literal `{` followed by `{`.
- A line that held nothing but comments, spaces and tabs is dropped.
- A comment that spans lines joins the text before it and the text after it into one line, as
  in GoldenDict; the lines in between, headwords included, are swallowed.
- A comment that is not closed swallows the rest of the file (`DSL2101`, error).

## Headwords

| Syntax  | Meaning |
| ------- | ------- |
| `(...)` | An optional part: `colo(u)r` is listed as `color` and `colour`. Groups may follow each other and nest. |
| `{...}` | The unsortable part: shown, but not indexed: `{to }walk` is listed as `walk`. Tags are only allowed here. |
| `\x`    | The literal character `x`, for any `x`: `\(`, `\{`, `\~`, `\#`, `\\`. An escaped space is a no-break space. |
| `~`     | In a sub-entry's headwords, and in an entry's headwords after the first: the first index form of the entry's first headword. `^~` flips the case of its first letter. |

How headwords become `display`, `text` and `variants`, with examples and limits, is in
[ast.md](ast.md#headwords). Recovery, each reported:

- an unclosed `{` makes the rest of the headword unsortable (`DSL3001`); a stray `}` is ignored
  (`DSL3002`);
- an unclosed `(` runs to the end of the headword (`DSL3003`); a stray `)` is shown but ignored
  in the index forms (`DSL3004`);
- a tag or link outside braces is parsed, and its text is sortable (`DSL3101`);
- a `~` with nothing to stand for is kept as text (`DSL3102`).

## Body markup

| Syntax            | Meaning |
| ----------------- | ------- |
| `[name]...[/name]`| A tag; see [Tags](#tags). Names are lowercase; a tag never spans lines, but its content may. |
| `\x`              | The literal character `x`, for any `x`. `\ ` is a no-break space (a plain space inside `[s]` and `[video]`, where file names keep theirs). A `\` at the end of a line is kept (`DSL4003`, info). |
| `[[`, `]]`        | Literal `[` and `]`. A lone `]` is literal too. |
| `~`, `^~`         | The headword; `^~` with the case of its first letter flipped. |
| `^x`              | `x` with its case flipped, if `x` is a letter that has case. Before anything else the `^` is literal (`DSL4004`, info). |
| `<<target>>`      | A link to another entry of the same dictionary. It ends at the first `>>` on its line; its content is text. |
| `@ headword`, `@` | A sub-entry; see below. |

A `[` without a `]` on its line, or followed by another `[` first, is literal (`DSL4001`), and
so are `[]`, `[/]`, `[ b]` and names with a backslash (`DSL4002`). A `<<` without `>>` on its
line is literal (`DSL4005`), and so is `<<>>` (`DSL4006`).

## Sub-entries

A sub-entry is an entry inside an entry's body, typically a phrase or a derived word. It starts
with one or more `@ headword` lines and ends with a lone `@`:

```text
walk
	[m1][trn]gehen[/trn]
	@ ~ out
	[m1][trn]hinausgehen[/trn]
	@
```

- A body line whose first character, after spaces, tabs and tags, is an unescaped `@` is a
  marker: a start if other text than closing tags follows, else an end (`@[/m]` closes the
  tags after the sub-entry).
- Consecutive start lines give one sub-entry several headwords; `~` in them is the parent's
  headword.
- A start after other lines of an open sub-entry closes it implicitly, as does the end of the
  entry (`DSL2301`); an end without an open sub-entry is ignored (`DSL2302`).
- A sub-entry nests inside the tags open where it occurs. Tags opened inside it are closed at its
  end, and tags of the parent cannot be closed from inside it.

## Tags

The registry of tags behind the parser (`getTagSpec`), from the DSL manual and the DSL
Reference. Tag names are lowercase: `[B]` is not `[b]`.

<!-- generated: tags -->
| Tag | Kind | Closing tag | Attributes | In headwords | Notes |
| --- | --- | --- | --- | --- | --- |
| `[b]` | format | required | - | - | Bold text. Body only; any tags may be nested. |
| `[i]` | format | required | - | - | Italic text. Body only; any tags may be nested. |
| `[u]` | format | required | - | - | Underlined text. Body only; any tags may be nested. |
| `[c]` | format | required | optional color name: `[c red]` | in `{...}` | Colored text: bare `[c]` uses the label color, `[c name]` a lowercase HTML color name. |
| `[sup]` | format | required | - | in `{...}` | Superscript. Accepted in headwords but not recommended (only the position changes). |
| `[sub]` | format | required | - | in `{...}` | Subscript. Accepted in headwords but not recommended (only the position changes). |
| `[m]`, `[m0]`..`[m9]` | format | optional | the level, a digit in the name: `[m2]` | - | Paragraph margin: `[m]` or `[m0]`..`[m9]`; opening it starts a new line; zone ends at the next `[m...]`. |
| `[']` | format | required | - | in `{...}` | Stressed vowel: `[']` and `[/']`. Not allowed inside `[ref]` or `<<...>>`. |
| `[br]` | format | none | - | in `{...}` | Line break; has no closing tag. Undocumented by Lingvo. |
| `[p]` | structure | required | - | in `{...}` | Label (abbreviation); excluded from the index and not affected by outer styling. |
| `[t]` | structure | required | - | in `{...}` | Transcription; rendered in a special font, other tags are forbidden inside. Undocumented by Lingvo. |
| `[*]` | structure | required | - | in `{...}` | Secondary text that the viewer can hide; `[c]` has no effect next to it. |
| `[ex]` | zone | required | - | - | Indexing zone of examples; body only. |
| `[com]` | zone | required | - | - | Indexing zone of comments; body only. |
| `[trn]` | zone | required | - | - | Indexing zone of translations; body only. |
| `[trn1]` | zone | required | - | - | Compiler-generated variant of `[trn]`; must not be written by hand. Undocumented by Lingvo. |
| `[!trs]` | zone | required | - | - | Excludes a fragment from the index; only valid inside `[ex]`/`[com]`/`[trn]`. |
| `[lang]` | lang | required | `id=1033` or `name="English"` (required) | - | Language of the text: `[lang id=1033]` or `[lang name="English"]`; body only. |
| `[s]` | media | required | - | in `{...}` | Media file (sound, image, video); contains only a bare file name. |
| `[video]` | media | required | - | in `{...}` | Video file; behaves exactly like `[s]`. Undocumented by Lingvo. |
| `[preview]` | media | required | - | - | Preview of a media file; only valid inside `[s]`/`[video]`, has no visible effect. Undocumented by Lingvo. |
| `[ref]` | link | required | optional `dict="..."`; `target="..."` (undocumented) | in `{...}` | Link to an entry of this or (with `dict="..."`) another dictionary; text only. |
| `[url]` | link | required | optional `target="..."` (undocumented) | in `{...}` | Link to an external address (web or e-mail); contains only the address. |
<!-- end: tags -->

Search zones: Lingvo indexes `[trn]`, `[ex]` and `[com]` (and the compiler-generated `[trn1]`)
for full-text search, leaves out `[!trs]` inside them, and leaves `[p]` labels out of the index.
`zoneText` and the `search-text` plugin follow these rules.

Attributes: `[c]` takes a color name (the HTML color names, lowercase; an unknown name is kept,
`DSL4106`). `[lang]` needs `id=` (a Windows LCID such as `1033`, or a legacy Lingvo id 1-30) or
`name="..."` (a Lingvo language name, `DSL4107` if inexact) (`DSL4105` if neither). Attributes on
a tag that takes none, or on a closing tag, are ignored (`DSL4103`); malformed or repeated ones
too (`DSL4104`).

## Recovery from malformed markup

Real dictionaries break the rules, so the parser never fails on markup: it recovers as
GoldenDict does, keeps the content, and reports what it did. In the order the rules apply:

1. **Text-only content.** Inside `[t]`, `[s]`, `[video]`, `[ref]`, `[url]` and `<<>>` links,
   every tag and link is literal text (`DSL4205`), except the matching closing tag and
   `[preview]` inside `[s]` and `[video]`.
2. **Unknown tags.** An unknown opening tag is kept as a tag if a closing tag of the same name
   follows somewhere (`DSL4101`), else as text (`DSL4102`, info); an unknown closing tag
   without an opening one is text (`DSL4102`).
3. **Depth.** Tags nested more than 64 levels deep: the extra opening tag is text (`DSL4207`).
4. **Margins.** `[m]` and `[m0]`..`[m9]` are block-level and need no closing tag: opening one
   closes every tag open in the body or sub-entry, the previous `[m]` included, and reopens the
   other tags inside the new margin (`[m1][*]a[m2]b[/*]` is `m1(*(a)) m2(*(b))`). No
   diagnostic: that is how the format is used. `[/m]` closes the open margin, whatever its level.
5. **Crossed tags.** `[b][i]x[/b]y[/i]` closes `[i]`, closes `[b]`, and reopens `[i]`:
   `b(i(x)) i(y)` (`DSL4203`, info: common, and rendered as intended).
6. **Stray closing tags** that match no open tag of the entry or sub-entry are ignored
   (`DSL4201`).
7. **A tag inside a tag of the same name** is nested (`DSL4204`).
8. **Misplaced tags** (`[preview]` outside `[s]` and `[video]`) are kept (`DSL4206`).
9. **Unclosed tags** are closed at the end of their entry, sub-entry or text (`DSL4202`, except
   for `[m]`).

The leniencies taken from GoldenDict, in short: language names in any case and without their
ending; blank lines between headwords and inside bodies; a directive value between the first and
the last quote; comments that span lines join them; `~` and `^~` in the later headwords of an
entry; an escaped space as a plain space in index forms; headwords longer than 500 characters
not expanded; crossed tags closed and reopened; `[m]` reopening the tags it closes.

## Not supported

- `#INCLUDE`: kept as a directive, but the file is not included (GoldenDict does not support it
  either, and its semantics are unclear).
- Reading media from `.dsl.files.zip`, rendering to HTML, writing DSL: out of scope; the AST is
  the input for tools that do these.
