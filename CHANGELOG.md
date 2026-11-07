# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/) (see [STABILITY.md](STABILITY.md)).

## [2.0.0] - Unreleased

A complete rewrite in TypeScript, with a new API. See [MIGRATION.md](MIGRATION.md) for the
upgrade from 1.x.

### Added

- `parseDsl`: parses a dictionary from bytes, a `Blob` or `File`, a stream or a string, lazily
  and as a stream, in constant memory, in Node.js and in browsers.
- Decoding: gzip and dictzip (`.dsl.dz`) input; encoding detection (BOM, UTF-16 without a BOM,
  UTF-8, `#SOURCE_CODE_PAGE`) with the `encoding` and `defaultEncoding` options; newline
  normalization.
- The whole format: header directives, comments, headwords with optional (`(...)`) and
  unsortable (`{...}`) parts expanded into index forms, escapes, `~` and `^`, sub-entries,
  links, and every tag of the DSL manual.
- An exact, JSON-serializable AST of every entry, with source positions, versioned by
  `AST_VERSION`; `walk` and `walkEntry` to traverse it.
- Diagnostics with stable codes for every problem and every recovery from malformed markup,
  tolerant by default as GoldenDict is; the `strict` option; `DIAGNOSTICS`, the catalog.
- Plugins: `definePlugin` and the plugin contract; the built-in `plain-text` and `search-text`
  plugins (`dsl-dicts/plugins`) and the experimental `article` plugin (`dsl-dicts/article`),
  the successor of the 1.x output, customizable with `createArticlePlugin`.
- Rendering helpers: `toPlainText`, `zoneText`, `hasZones`.
- Companion files: `parseAbbreviations` (`_abrv.dsl`) and `parseAnnotation` (`.ann`); in
  Node.js, `openDsl` opens a dictionary together with them, and `findDictionaries` lists the
  dictionaries of a directory (`dsl-dicts/node`).
- Export: `toJsonl` and `toJson`, with a versioned envelope; `readJsonl` reads JSONL back and
  checks the versions.
- The `dsl-dicts` command: `convert` (a file or a directory, to JSONL or JSON, with any plugin)
  and `info`, with stable exit codes.
- Lingvo reference data: languages (names, LCIDs, legacy ids, ISO codes), code pages, colors.
- TypeScript types.

### Changed

- ESM only, for Node.js 22.12 or later (`require()` works through `require(esm)`) and browsers.
- `parse()` is replaced by `parseDsl()` and, in Node.js, `openDsl()`.
- The `phrase` iterator, one item per headword, is replaced by `entries()`, an async iterator of
  one item per entry; `meta` by `header`.
- The phrase object is replaced by the AST, or by the output of the `article` plugin.
- Errors are `DslError`s with a stable `code`, instead of `ParseError`.

### Fixed

- Entries with several headwords no longer share one object that holds the last headword.
- An entry at the end of the file without a body is no longer lost.
- The source language of a dictionary is now checked, like the target language.
- Windows line endings, and parsing on Windows.
- Errors during iteration now reject the iteration instead of escaping the promise.
- Labels before the dash of an example no longer end up in its translation.

### Removed

- The 1.x API: `parse()`, `meta`, `phrase`, `ParseError`.

The dates of the 1.x versions are those of their commits.

## [1.0.4] - 2018-12-30

### Fixed

- A transcription followed by another `[t]` on the same line.

## [1.0.3] - 2018-12-30

### Fixed

- Headwords are trimmed.

## [1.0.2] - 2018-12-29

### Fixed

- Header directives with surrounding whitespace.

## [1.0.1] - 2018-12-29

### Fixed

- Leftover `debugger` statements removed.

## [1.0.0] - 2018-12-28

The first stable version: `parse()`, with the dictionary's name and languages and an iterator of
phrases (headword, transcription, translations and examples).

## [0.0.1] - 2018-12-20

The initial implementation.

[2.0.0]: https://github.com/borshak/dsl-dicts/compare/56cd482...v2
[1.0.4]: https://github.com/borshak/dsl-dicts/commit/56cd482
[1.0.3]: https://github.com/borshak/dsl-dicts/commit/a3f9b75
[1.0.2]: https://github.com/borshak/dsl-dicts/commit/c334427
[1.0.1]: https://github.com/borshak/dsl-dicts/commit/2294bb1
[1.0.0]: https://github.com/borshak/dsl-dicts/commit/d244560
[0.0.1]: https://github.com/borshak/dsl-dicts/commit/5bd28c1
