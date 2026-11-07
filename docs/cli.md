# The `dsl-dicts` command

The package installs a `dsl-dicts` command (Node.js 22.12 or later) that converts dictionaries
to JSONL or JSON and inspects them. Run it with `npx dsl-dicts` in a project that depends on
the package, or install the package globally.

- [Commands](#commands)
- [`convert`](#convert)
- [`info`](#info)
- [Diagnostics](#diagnostics)
- [Exit codes](#exit-codes)
- [Examples](#examples)
- [A plugin of your own](#a-plugin-of-your-own)

## Commands

<!-- generated: cli-usage -->
```text
Usage: dsl-dicts <command> [options]

Convert ABBYY Lingvo DSL dictionaries to JSON or JSONL, and inspect them.

Commands:
  convert <file|dir>  Convert a dictionary, or every dictionary in a directory
  info <file>         Show the header, decoding, companion files, entry count and diagnostics

Options:
  -h, --help          Show this help (also: dsl-dicts <command> --help)
  -v, --version       Print the version

Exit codes (stable: scripts may rely on them):
  0   success
  1   usage error (unknown command, option or plugin name, missing or invalid argument,
      plugin options the plugin refuses)
  2   dictionary or I/O error (unreadable input, failure in --strict mode, output not writable)
  3   plugin error (cannot be loaded, fails to set up or while processing an entry)
  70  internal error (a bug of dsl-dicts: please report it)
```
<!-- end: cli-usage -->

## `convert`

<!-- generated: cli-usage-convert -->
```text
Usage: dsl-dicts convert <file|dir> [options]

Converts a dictionary (.dsl, .dsl.dz, .dsl.gz) to JSONL (default) or JSON. A file goes to
standard output unless -o is given. For a directory, -o is required: every dictionary found is
converted to <output>/<relative directory>/<name>.<plugin>.jsonl (or .json; <plugin> is ast
without --plugin); where a dictionary exists both as foo.dsl and foo.dsl.dz, the uncompressed
file is used.

Options:
  -o, --output <path>        Output file, or directory (required for a directory input)
      --format <format>      jsonl (default): one record per line, streamed
                             json: one document { header, entries, summary }
      --pretty               Indent the document (json only)
      --plugin <name|path>   Export the output of a plugin instead of the parsed entries
                             (the AST, the default). A built-in plugin by name:
                               article      senses, translations, examples (experimental)
                               plain-text   headwords and body as plain text
                               search-text  index forms and the text to search in
                             or an ES module whose default export is a DslPlugin: a value
                             with a path separator, or ending with .js or .mjs. The
                             module's code is executed, so use only plugins you trust.
      --plugin-options <json>  Options for the plugin, as JSON
      --no-positions         Leave positions out of the AST
      --encoding <label>     Force the encoding (a code page name such as Cyrillic, or a
                             label such as utf-16le); skips automatic detection
      --default-encoding <label>
                             Encoding of 8-bit files in which none is detected
                             (default: windows-1251)
      --abbreviations <path> Read the abbreviations from this file (for every dictionary of a
                             directory) instead of looking for <name>_abrv.dsl next to it
      --annotation <path>    Read the annotation from this file instead of <name>.ann
      --no-companions        Do not look for the abbreviations, annotation, icon and media
                             files next to the dictionary (explicit paths are still read)
      --strict[=<severity>]  Fail (exit 2) at the first diagnostic of this severity or a
                             more severe one: error (the default), warning or info
      --summary              End the output with a summary: entry count, diagnostics by code
      --recursive            Look in subdirectories too (directory input)
      --verbose              Print every diagnostic to standard error, with its position
  -q, --quiet                Print no diagnostics
  -h, --help                 Show this help

The output is JSONL by default: a header record (format, versions, plugin, dictionary,
decoding), one {"type":"entry","data":...} record per entry, and optionally a summary.

Exit codes (stable: scripts may rely on them):
  0   success
  1   usage error (unknown command, option or plugin name, missing or invalid argument,
      plugin options the plugin refuses)
  2   dictionary or I/O error (unreadable input, failure in --strict mode, output not writable)
  3   plugin error (cannot be loaded, fails to set up or while processing an entry)
  70  internal error (a bug of dsl-dicts: please report it)
```
<!-- end: cli-usage-convert -->

Notes:

- Without `--plugin`, each entry record holds the AST entry (`DslEntry`, see [ast.md](ast.md)).
  `--no-positions` makes it much smaller.
- The output format is described in [jsonl.md](jsonl.md). JSONL is written as the dictionary is
  read, in constant memory; `--format json` writes one document, which also streams but can
  only be read back as a whole.
- With a directory, every dictionary found (`.dsl`, `.dsl.dz`, `.dsl.gz`; abbreviations files
  are not dictionaries) is converted, and a failure of one does not stop the others: the exit
  code is that of the most serious failure. A dictionary that exists both as `foo.dsl` and
  `foo.dsl.dz` is converted once, from the `.dsl`.
- An output file that cannot be completed is removed.
- `--abbreviations` and `--annotation` name companion files explicitly, for a dictionary whose
  files are named differently; with a directory, the same files are used for every dictionary.
- A plugin module is loaded once, before any output; `--plugin-options` is passed to its
  `setup`.
- `dsl-dicts convert ... | head` stops quietly when the reader closes the pipe.

## `info`

<!-- generated: cli-usage-info -->
```text
Usage: dsl-dicts info <file> [options]

Prints the header of a dictionary, how it was decoded, its companion files, the number of
entries and the diagnostics by code. The whole file is read.

Options:
      --format <format>      text (default), or json: one JSON document
      --encoding <label>     Force the encoding (a code page name such as Cyrillic, or a
                             label such as utf-16le); skips automatic detection
      --default-encoding <label>
                             Encoding of 8-bit files in which none is detected
                             (default: windows-1251)
      --abbreviations <path> Read the abbreviations from this file (for every dictionary of a
                             directory) instead of looking for <name>_abrv.dsl next to it
      --annotation <path>    Read the annotation from this file instead of <name>.ann
      --no-companions        Do not look for the abbreviations, annotation, icon and media
                             files next to the dictionary (explicit paths are still read)
      --strict[=<severity>]  Fail (exit 2) at the first diagnostic of this severity or a
                             more severe one: error (the default), warning or info
      --verbose              Print every diagnostic to standard error, with its position
  -q, --quiet                Print no diagnostics to standard error (the default)
  -h, --help                 Show this help

Exit codes (stable: scripts may rely on them):
  0   success
  1   usage error (unknown command, option or plugin name, missing or invalid argument,
      plugin options the plugin refuses)
  2   dictionary or I/O error (unreadable input, failure in --strict mode, output not writable)
  3   plugin error (cannot be loaded, fails to set up or while processing an entry)
  70  internal error (a bug of dsl-dicts: please report it)
```
<!-- end: cli-usage-info -->

`info` reads the whole dictionary. The text report lists the header, how it was decoded, the
companion files, the number of entries and the diagnostics by code with their summaries. The
`--format json` report has the same information; its shape is meant for inspection and may gain
fields in a minor version (see [STABILITY.md](../STABILITY.md)).

## Diagnostics

Diagnostics go to standard error, never to standard output:

- by default, `convert` prints one summary line per dictionary that has any:
  `en-de.dsl: 3 diagnostics (DSL2203 x1, DSL4202 x2); use --verbose to list them`;
- `--verbose` prints every diagnostic as it is found, as
  `file:line:column: severity CODE message`;
- `-q`, `--quiet` prints none (the default of `info`, which lists them in its report).

`--strict` (`--strict=error`) stops at the first diagnostic of severity `error`;
`--strict=warning` also stops at warnings, `--strict=info` at anything. The command then exits
with code 2 and names the diagnostic. Companion files never fail in strict mode: their problems
are always diagnostics.

## Exit codes

The exit codes are stable: scripts may rely on them.

| Code | Meaning |
| ---- | ------- |
| 0    | Success. |
| 1    | Usage error: unknown command, option or plugin name, a missing or invalid argument (an unknown encoding, invalid `--plugin-options` JSON), or plugin options the plugin refuses. |
| 2    | Dictionary or I/O error: an unreadable input, a failure in `--strict` mode, an output that cannot be written, no dictionary in a directory. |
| 3    | Plugin error: the plugin cannot be loaded, is not a valid plugin, fails to set up or fails on an entry, or its output is not JSON. |
| 70   | Internal error: a bug of dsl-dicts. Please report it, with the stack trace printed. |

## Examples

Convert one dictionary to JSONL on standard output, or to a file:

```sh
dsl-dicts convert en-de.dsl.dz > en-de.ast.jsonl
dsl-dicts convert en-de.dsl.dz --no-positions -o en-de.ast.jsonl
```

Convert a directory tree, keeping its layout: `dicts/a/b.dsl` becomes `out/a/b.article.jsonl`:

```sh
dsl-dicts convert dicts/ --recursive --plugin article -o out/
```

Plain text, search text and options of a plugin:

```sh
dsl-dicts convert en-de.dsl.dz --plugin plain-text --plugin-options '{"indent":"  ","expandLabels":true}'
dsl-dicts convert en-de.dsl.dz --plugin search-text --plugin-options '{"labels":true}' -o search/
```

Pipe to `jq`: the headwords, and the translations of each sense, of every entry:

```sh
dsl-dicts convert en-de.dsl.dz --plugin article -q \
  | jq -c 'select(.type == "entry") | .data | [.headwords[0].text, [.senses[].translations[]]]'
```

Check a dictionary in CI: fail on any warning, and print every diagnostic:

```sh
dsl-dicts info en-de.dsl.dz --strict=warning --verbose
```

An 8-bit dictionary without `#SOURCE_CODE_PAGE`, in a Western code page; one JSON document:

```sh
dsl-dicts convert old-de.dsl --default-encoding Latin --format json --pretty -o old-de.json
```

The entry count and encoding, from the JSON report:

```sh
dsl-dicts info en-de.dsl.dz --format json | jq '{entries, encoding: .decode.encoding}'
```

## A plugin of your own

`--plugin` also takes the path of an ES module (a value with a path separator, or ending with
`.js` or `.mjs`) whose default export is a plugin (see [plugins.md](plugins.md)). The module's
code is run: use only plugins you trust.

<!-- example: cli-plugin -->
```js
// headword-lengths.mjs: dsl-dicts convert en-de.dsl --plugin ./headword-lengths.mjs
// The default export is a DslPlugin: a name, the version of its output, and setup.

/** @type {import('dsl-dicts').DslPlugin<{ headword: string, length: number }>} */
export default {
  name: 'headword-lengths',
  version: '1.0.0',
  setup: () => (entry) => {
    const headword = entry.headwords[0]?.variants[0] ?? '';
    return { headword, length: [...headword].length };
  },
};
```

```sh
dsl-dicts convert en-de.dsl.dz --plugin ./headword-lengths.mjs -o lengths/
```

writes `lengths/en-de.headword-lengths.jsonl`, whose header records the plugin as
`{"name":"headword-lengths","version":"1.0.0"}`.
