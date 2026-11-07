/**
 * `parseAbbreviations`: the `_abrv.dsl` abbreviations file of a dictionary.
 *
 * @packageDocumentation
 */

import type { DecodeDslOptions } from '../decode/decode.js';
import type { DslSource } from '../decode/source.js';
import {
  CATALOG,
  createDiagnostic,
  type DiagnosticSink,
  dslError,
  optionsSink,
} from '../diagnostics/index.js';
import { parseMarkup } from '../markup/parse.js';
import { parseDsl } from '../parse/parse.js';
import { normalizeLabel, toPlainText } from '../render/plain-text.js';

/**
 * Options of {@link parseAbbreviations}: those of `decodeDsl` (encoding detection, `.dz`
 * decompression, `diagnostics`, `strict`).
 */
export type ParseAbbreviationsOptions = DecodeDslOptions;

/**
 * A sink that drops `DSL2001` (a missing mandatory directive): abbreviations files often have
 * no header at all, and reporting that for every dictionary is noise.
 */
function withoutMissingDirectives(sink: DiagnosticSink | undefined): DiagnosticSink | undefined {
  return sink === undefined
    ? undefined
    : {
        report(diagnostic) {
          if (diagnostic.code !== CATALOG.missingDirective.code) sink.report(diagnostic);
        },
      };
}

/**
 * Parses the abbreviations file of a dictionary (`_abrv.dsl`, or `_abrv.dsl.dz`) into a map
 * from abbreviation to expansion, for the `abbreviations` option of `parseDsl` and `[p]`
 * labels.
 *
 * The file is an ordinary DSL file, read with the same pipeline as `parseDsl`: each entry is
 * an abbreviation, its headwords are the labels as they are written in `[p]`, and the first
 * line of its body with any text is the expansion. Tags are not expected in an abbreviations
 * file; if there are any, they are dropped and their text kept (the plain text of the line, as
 * `toPlainText` renders it).
 *
 * - Key: `Headword.text` of each headword, normalized with `normalizeLabel`. All headwords of
 *   an entry give the same expansion. `(` and `{` in a headword are not interpreted: the key
 *   is the text as displayed.
 * - Value: the plain text of the first body line with text.
 * - A key defined more than once keeps its first expansion (`DSL6001`); an entry without a
 *   body text is skipped (`DSL6002`).
 *
 * An abbreviations file is not required to have a header, so a missing `#NAME`,
 * `#INDEX_LANGUAGE` or `#CONTENTS_LANGUAGE` (`DSL2001`) is not reported.
 *
 * The map is in file order. Keys are normalized with the same function as the `[p]` lookup of
 * `toPlainText`, so the map can be passed to it and to `parseDsl` as is.
 *
 * @example
 * ```ts
 * const abbreviations = await parseAbbreviations(await file.arrayBuffer());
 * abbreviations.get('adj.'); // 'adjective'
 * ```
 *
 * @returns The map. Problems are reported as diagnostics; see the `diagnostics` and `strict`
 * options.
 * @throws DslError for invalid arguments (`DSL0001`, `DSL1002`, `DSL1003`), unreadable input
 * (`DSL1001`) or, in strict mode, a diagnostic of severity `error`.
 */
export async function parseAbbreviations(
  source: DslSource,
  options: ParseAbbreviationsOptions = {},
): Promise<Map<string, string>> {
  if (typeof options !== 'object' || options === null) {
    throw dslError('invalidArgument', 'Options must be an object.');
  }
  const inner = withoutMissingDirectives(options.diagnostics);
  const parsed = parseDsl(source, {
    ...options,
    diagnostics: inner,
    body: 'raw',
    positions: false,
  });
  const sink = optionsSink({ diagnostics: inner, strict: options.strict });
  const abbreviations = new Map<string, string>();
  for await (const batch of parsed.batches()) {
    for (const entry of batch) {
      let expansion = '';
      for (const line of entry.body) {
        if (line.kind !== 'text') continue;
        expansion = toPlainText(parseMarkup(line, { positions: false, diagnostics: sink }), {
          headwords: entry.headwords,
        });
        if (expansion.length > 0) break;
      }
      if (expansion.length === 0) {
        sink?.report(
          createDiagnostic(
            'emptyAbbreviation',
            `The abbreviation "${entry.headwords[0]?.text}" has no expansion.`,
            { position: entry.position },
          ),
        );
        continue;
      }
      for (const headword of entry.headwords) {
        const key = normalizeLabel(headword.text);
        if (abbreviations.has(key)) {
          sink?.report(
            createDiagnostic(
              'duplicateAbbreviation',
              `The abbreviation "${key}" is defined more than once; the first definition is used.`,
              { position: headword.position ?? entry.position },
            ),
          );
        } else {
          abbreviations.set(key, expansion);
        }
      }
    }
  }
  return abbreviations;
}
