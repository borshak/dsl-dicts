# Diagnostics

<!-- Generated from src/diagnostics/catalog.ts by `npm run docs`: do not edit. -->

Every problem dsl-dicts finds has a code, `DSL` and four digits. This page lists them all,
70 in this version, with their default severity and whether they are reported or thrown.
The same table is available at run time as `DIAGNOSTICS` (`findDiagnosticSpec(code)`).

- **Reported** diagnostics are plain objects (`Diagnostic`): `code`, `severity`, `message`,
  `position` (`{ offset, line, column }`, one-based line and column) and, for problems found
  while decoding bytes, `byteOffset`. They go to the `diagnostics` sink of the options, to
  `ParsedDsl.diagnostics` and `diagnosticCounts()`, and to `DslEntry.diagnostics` for the
  headwords and body of an entry; parsing goes on. With the `strict` option, the first one
  of the strict severity or a more severe one is thrown as a `DslError` with the same `code`
  and the diagnostic in `error.diagnostic`.
- **Thrown** codes are never reported: they only reach you as a `DslError`, from the call,
  the iteration or the promise that failed. Runtime errors are wrapped, with the original
  error as `cause`.

Severities: `error` (the input is broken and content may be lost), `warning` (the input is
suspect; the result is a best guess) and `info` (a remark; nothing is lost).

## Compatibility

- Codes are stable identifiers: a released code keeps its meaning and is never reused. Match
  on `code`.
- New codes are added in minor versions, so expect codes you do not know.
- The default severity of a code is part of the contract (strict mode depends on it): it
  changes only in a major version.
- Messages are not stable: their wording may change in any version. The `name` of a catalog
  entry is informational too.
- Codes of plugins are namespaced by the plugin name, `<plugin-name>/<id>` (see
  `createPluginDiagnostic`); a plugin that gives no code reports `DSL5101`. Plugins choose
  the severity of what they report.

## DSL0xxx: API usage

Invalid arguments, misuse of single-use results, and cancellation.

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL0001` | error | thrown | An argument or option has an invalid type or value. |
| `DSL0002` | error | thrown | A single-use result was iterated more than once. |
| `DSL0003` | error | thrown | Processing was cancelled before the requested result was available, or aborted with the signal option (the abort reason is the cause). |

## DSL1xxx: input, decompression and encoding

Reading the source, gzip and dictzip decompression, encoding detection and decoding.

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL1001` | error | thrown | Reading the input source failed; the original error is the cause. |
| `DSL1002` | error | thrown | The encoding option is neither a Lingvo code page name nor a known encoding label. |
| `DSL1003` | error | thrown | The encoding is known but this runtime cannot decode it. |
| `DSL1004` | error | thrown | The input is gzip-compressed but this runtime has no DecompressionStream. |
| `DSL1101` | error | reported | The gzip data is invalid, truncated, has trailing data or several members; decoding stops. |
| `DSL1201` | warning | reported | The byte order mark contradicts the forced encoding and is decoded as text. |
| `DSL1202` | warning | reported | The #SOURCE\_CODE\_PAGE value is not recognized; the default encoding is used. |
| `DSL1203` | warning | reported | The #SOURCE\_CODE\_PAGE encoding is unsupported by this runtime or not ASCII-compatible; the default encoding is used. |
| `DSL1204` | info | reported | The #SOURCE\_CODE\_PAGE directive is ignored because a BOM or UTF-16 was detected. |
| `DSL1205` | warning | reported | The #SOURCE\_CODE\_PAGE directive is ignored because the content is valid UTF-8. |
| `DSL1206` | warning | reported | The decoded text contains U+FFFD: the input is probably malformed for the chosen encoding. Reported once per input. |

## DSL2xxx: segmentation

The header and its directives, entries, sub-entries and `{{...}}` comments.

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL2001` | warning | reported | A mandatory directive (#NAME, #INDEX\_LANGUAGE or #CONTENTS\_LANGUAGE) is missing. |
| `DSL2002` | warning | reported | A directive has no name or its value is not enclosed in double quotes; the value is taken as is. |
| `DSL2003` | warning | reported | A directive occurs more than once in the header; the first occurrence is used. |
| `DSL2004` | info | reported | A header directive is not known; it is kept as is. |
| `DSL2005` | warning | reported | A language directive names a language unknown to Lingvo, even read leniently as GoldenDict does (see DSL2007). |
| `DSL2006` | warning | reported | A line starting with # after the header is ignored; escape it as \\# for a headword. |
| `DSL2007` | info | reported | A language directive names a Lingvo language inexactly (case, or without an ending such as ModernSort); it is resolved as GoldenDict does. |
| `DSL2101` | error | reported | A {{ comment is not closed: it swallows the rest of the input. |
| `DSL2201` | warning | reported | An indented line before the first headword is ignored. |
| `DSL2202` | warning | reported | Blank lines between headwords or between the headwords and the body are skipped. |
| `DSL2203` | warning | reported | Blank lines inside a body are skipped; the body goes on after them. |
| `DSL2204` | warning | reported | The input ends after headwords without a body; the entry has an empty body. |
| `DSL2301` | warning | reported | A sub-entry is not closed by a lone @ before the next sub-entry or the end of the entry. |
| `DSL2302` | warning | reported | A lone @ closes no open sub-entry. |

## DSL3xxx: headwords

Braces, parentheses, `~` and markup in headwords; limits.

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL3001` | warning | reported | A { in a headword is not closed: the rest of the headword is unsortable. |
| `DSL3002` | warning | reported | A } in a headword closes no {; it is ignored. |
| `DSL3003` | warning | reported | A ( in a headword is not closed: the optional part runs to the end of the headword. |
| `DSL3004` | warning | reported | A ) in a headword closes no (; it is shown but ignored in the index forms. Escape it as \\) for a literal parenthesis. |
| `DSL3101` | warning | reported | A headword has a tag or link outside the unsortable part {...}, where Lingvo forbids them; it is parsed, and its text is part of the index forms. Reported once per headword. |
| `DSL3102` | warning | reported | A \~ in a headword has no headword to stand for (it is in the first headword of an entry, or the parent's headwords are not known); it is kept as text in the index forms. |
| `DSL3201` | warning | reported | A headword has no sortable text, so no index form: it is all unsortable or empty. |
| `DSL3202` | warning | reported | The sortable text of a headword is longer than 500 characters: its optional parts are not expanded (as in GoldenDict) and the parentheses are kept. |
| `DSL3203` | warning | reported | A headword expands to more than 256 index forms; only the first 256 are kept. |

## DSL4xxx: body markup

Tags, links, escapes and the recovery of malformed markup.

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL4001` | warning | reported | A \[ has no closing \] on its line, or another \[ comes first; it is kept as text. |
| `DSL4002` | warning | reported | A tag has no name, does not start right after the bracket, or has a backslash in its name (\[\], \[/\], \[ b\]); it is kept as text. |
| `DSL4003` | info | reported | A backslash at the end of a line escapes nothing; it is kept as text. |
| `DSL4004` | info | reported | A ^ is not followed by a character or \~ whose case it could change; it is kept as text. |
| `DSL4005` | warning | reported | A \<\< is not closed by \>\> on its line; it is kept as text. |
| `DSL4006` | warning | reported | A \<\<\>\> link has no target; it is kept as text. |
| `DSL4101` | warning | reported | A tag name is not in the registry (names are lowercase); it is kept as a tag because a matching closing tag follows. |
| `DSL4102` | info | reported | An unknown tag name without a matching closing tag, or an unknown closing tag without an opening one, is kept as text. |
| `DSL4103` | warning | reported | A tag that takes no attributes, or a closing tag, has attributes; they are ignored. |
| `DSL4104` | warning | reported | An attribute is malformed, repeated or not valid for its tag; it is ignored. |
| `DSL4105` | warning | reported | A mandatory attribute is missing: \[lang\] needs id or name. |
| `DSL4106` | warning | reported | An attribute value is unknown (a color name, language id or language name); it is kept. |
| `DSL4107` | info | reported | A \[lang name="..."\] names a Lingvo language inexactly (case, or without an ending such as ModernSort); the name is kept as written and resolveLanguageName resolves it. |
| `DSL4201` | warning | reported | A closing tag matches no open tag of the entry or sub-entry; it is ignored. |
| `DSL4202` | warning | reported | A tag other than \[m\] is still open at the end of its entry, sub-entry or text; it is closed there. |
| `DSL4203` | info | reported | Tags overlap, as in \[b\]\[i\]x\[/b\]y\[/i\]: the tags opened inside are closed and reopened after the closing tag. Common in real dictionaries and rendered as intended. |
| `DSL4204` | warning | reported | A tag is opened inside a tag of the same name; it is nested. |
| `DSL4205` | warning | reported | A tag or link inside a text-only tag (\[t\], \[s\], \[video\], \[ref\], \[url\]) or inside a \<\<\>\> link is kept as text. |
| `DSL4206` | warning | reported | A tag is outside the tags it is valid in (\[preview\] outside \[s\] and \[video\]). |
| `DSL4207` | warning | reported | Tags are nested more than 64 levels deep; the extra opening tag is kept as text. |

## DSL5xxx: plugins

`DSL50xx` are failures of a plugin, thrown as a `DslError` whose `plugin` names it; `DSL51xx` are what plugins report through `DictionaryContext.diagnostics`.

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL5001` | error | thrown | A plugin's setup threw or did not return a function; the original error is the cause. |
| `DSL5002` | error | thrown | A plugin threw while processing an entry; the original error is the cause, and the error has the plugin's name and the entry's position. |
| `DSL5101` | warning | reported | A plugin reports a problem with an entry or the dictionary; the message names the plugin, and the plugin may set any severity. |

## DSL6xxx: companion files

`DSL60xx` are problems in the content of an abbreviations file (`parseAbbreviations`); `DSL61xx` are problems finding or reading the files next to a dictionary (`dsl-dicts/node`).

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL6001` | warning | reported | An abbreviation is defined more than once in the abbreviations file; the first definition is used. |
| `DSL6002` | warning | reported | An abbreviation has no expansion (its body has no text); it is skipped. |
| `DSL6101` | warning | reported | A companion file of the dictionary (abbreviations, annotation) or its directory could not be read or decoded; it is ignored and the original error is the cause. |
| `DSL6102` | warning | reported | A companion file named explicitly in the options does not exist; it is ignored. |

## DSL7xxx: serialization

A JSONL document this version cannot read (`readJsonl`), or output that cannot be serialized (`toJsonl`, `toJson`).

| Code | Severity | Delivery | Summary |
| --- | --- | --- | --- |
| `DSL7001` | error | thrown | The input is not a dsl-dicts JSONL document: the header record is missing or malformed, or its format is not dsl-dicts/jsonl. |
| `DSL7002` | error | thrown | The major version of the JSONL format is not one this version can read. |
| `DSL7003` | error | thrown | The AST version of the JSONL document differs from the one the reader expects. |
| `DSL7004` | error | thrown | The plugin of the JSONL document differs from the one the reader expects, by name or by major version of its output format. |
| `DSL7005` | error | thrown | A JSONL record is not valid JSON, not an object, or has no type. |
| `DSL7006` | error | thrown | An entry or the output of a plugin cannot be serialized to JSON. |
