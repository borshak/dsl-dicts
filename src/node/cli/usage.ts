/**
 * Help texts of the CLI.
 *
 * @packageDocumentation
 */

const EXIT_CODES = `Exit codes (stable: scripts may rely on them):
  0   success
  1   usage error (unknown command, option or plugin name, missing or invalid argument,
      plugin options the plugin refuses)
  2   dictionary or I/O error (unreadable input, failure in --strict mode, output not writable)
  3   plugin error (cannot be loaded, fails to set up or while processing an entry)
  70  internal error (a bug of dsl-dicts: please report it)
`;

const SHARED = `      --encoding <label>     Force the encoding (a code page name such as Cyrillic, or a
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
                             more severe one: error (the default), warning or info`;

export const USAGE = `Usage: dsl-dicts <command> [options]

Convert ABBYY Lingvo DSL dictionaries to JSON or JSONL, and inspect them.

Commands:
  convert <file|dir>  Convert a dictionary, or every dictionary in a directory
  info <file>         Show the header, decoding, companion files, entry count and diagnostics

Options:
  -h, --help          Show this help (also: dsl-dicts <command> --help)
  -v, --version       Print the version

${EXIT_CODES}`;

export const CONVERT_USAGE = `Usage: dsl-dicts convert <file|dir> [options]

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
${SHARED}
      --summary              End the output with a summary: entry count, diagnostics by code
      --recursive            Look in subdirectories too (directory input)
      --verbose              Print every diagnostic to standard error, with its position
  -q, --quiet                Print no diagnostics
  -h, --help                 Show this help

The output is JSONL by default: a header record (format, versions, plugin, dictionary,
decoding), one {"type":"entry","data":...} record per entry, and optionally a summary.

${EXIT_CODES}`;

export const INFO_USAGE = `Usage: dsl-dicts info <file> [options]

Prints the header of a dictionary, how it was decoded, its companion files, the number of
entries and the diagnostics by code. The whole file is read.

Options:
      --format <format>      text (default), or json: one JSON document
${SHARED}
      --verbose              Print every diagnostic to standard error, with its position
  -q, --quiet                Print no diagnostics to standard error (the default)
  -h, --help                 Show this help

${EXIT_CODES}`;
