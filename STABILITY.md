# Stability

dsl-dicts follows [Semantic Versioning](https://semver.org/). From 2.0.0 on, a change that can
break code written against what is covered below comes only in a major version. Minor versions
add features in a compatible way; patch versions fix bugs.

## Covered by semver

- **The public API**: every export of the entry points `dsl-dicts`, `dsl-dicts/plugins` and
  `dsl-dicts/node`, with the behaviour their documentation (TSDoc) describes. The exports are
  listed in [`test/api/public-api.txt`](test/api/public-api.txt), a snapshot that a test checks
  against the sources, so that no change of the surface goes unnoticed. Deep imports (`dist/...`)
  are not part of the API, and the `exports` map of the package does not allow them.
- **The AST**: the node types and their fields, `DslEntry`, `Headword`, `SourcePosition`, and
  `AST_VERSION` ([docs/ast.md](docs/ast.md#evolution-policy)).
- **The plugin contract**: `DslPlugin`, `DictionaryContext`, `PluginUse`, how `setup` and the
  transform are called, and the errors that wrap their failures
  ([docs/plugins.md](docs/plugins.md#the-contract)).
- **The output of the `plain-text` and `search-text` plugins**, versioned by their own `version`
  (now `1.0.0`): a breaking change to it is a new major version of the plugin and of
  dsl-dicts.
- **The JSONL envelope**: the record types and the fields of the header and summary,
  `JSONL_FORMAT` and `JSONL_FORMAT_VERSION`, and what `readJsonl` accepts
  ([docs/jsonl.md](docs/jsonl.md#versions-and-compatibility)).
- **Diagnostic codes**: the meaning of each code, whether it is reported or thrown, and its
  default severity, which strict mode depends on. A released code is never reused
  ([docs/diagnostics.md](docs/diagnostics.md)).
- **The CLI**: the commands, their options and what they mean, the output files and their
  names, and the exit codes ([docs/cli.md](docs/cli.md#exit-codes)).
- **The supported runtimes**: Node.js 22.12 and later, and browsers with the web APIs the core
  uses. Dropping a Node.js version is a major version.

What a compatible (minor) change may still do:

- add exports, options, optional fields of options and results, and members to types that are
  open by design: `DiagnosticCode` and `Diagnostic.code`, `ArticleKind`, `EncodingSource`;
- add node types, fields and attribute keys to the AST (consumers ignore what they do not
  know), and new tag names, which appear as `tag` nodes;
- add diagnostic codes, record types to the JSONL envelope, fields to its records;
- grow the reference data: languages, code page names, colors.

## Not covered

These may change in any minor version:

- **Messages**: of diagnostics, of errors, and the human-readable output of the CLI (help, the
  `info` text report, lines on standard error). Match on codes, not on messages. The `name` of a
  catalog entry (`DiagnosticSpec.name`) is informational too.
- **The JSON report of `dsl-dicts info --format json`**: meant for inspection; it may change
  shape in a minor version.
- **Experimental APIs** (marked `@experimental` in the TSDoc):
  - `dsl-dicts/article`: the `article` plugin, its options, its output (`Article`), and
    `createArticlePlugin` with its classifiers and extractors. Reading the meaning of an entry
    is a heuristic that will be improved; `ARTICLE_VERSION`, the plugin's `version`, tells
    which format an output follows, and is recorded in exports.
  - The tag registry: `getTagSpec`, `TagSpec`, `TagKind`, `TagAttrs` and `TagDialect` may gain
    fields and values.
- **Recovery and heuristics on malformed input**: a fix that makes the result of a broken or
  ambiguous input closer to what the format means, or to what GoldenDict shows, is a patch or
  minor change, even though it changes the AST of that input. Such changes are listed in the
  changelog.
- **Performance and memory use**, chunk sizes, and how `batches()` groups entries.
- **Internals**: anything that is not exported, and the layout of `dist`.

If you store or exchange the output of the `article` plugin, check `plugin.version` in the JSONL
header (`readJsonl` does it with `expect.plugin`), or pin a minor version of dsl-dicts.

## Deprecation

Before an API is removed or changed incompatibly in a major version, it is deprecated in a minor
version where possible: marked `@deprecated` in the TSDoc with the replacement, listed under
"Deprecated" in the [changelog](CHANGELOG.md), and kept working until the next major version.
