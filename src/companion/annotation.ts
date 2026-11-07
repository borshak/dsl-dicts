/**
 * `parseAnnotation`: the `.ann` annotation file of a dictionary.
 *
 * @packageDocumentation
 */

import { type LanguageInfo, resolveLanguageName } from '../data/languages.js';
import { type DecodeOptions, decodeDsl } from '../decode/decode.js';
import type { DslSource } from '../decode/source.js';
import { createDiagnostic, createStrictSink, type Diagnostic } from '../diagnostics/index.js';
import { parseDirective } from '../segment/header.js';

/**
 * One section of an {@link Annotation}: the description in one language.
 *
 * @experimental
 */
export interface AnnotationSection {
  /**
   * The language name of the `#LANGUAGE "..."` line that starts the section, as written.
   * Absent for text that comes before the first `#LANGUAGE` line, or for the only section of
   * an annotation that has no such line.
   */
  readonly name?: string;
  /**
   * The language `name` names, resolved leniently like the languages of the header
   * (`resolveLanguageName`); absent if the section has no name or the name is unknown
   * (`DSL2005`).
   */
  readonly language?: LanguageInfo;
  /**
   * The section's text: plain text, with `\n` line breaks, as written. Only the blank lines
   * at its start and the whitespace at its end are removed.
   */
  readonly text: string;
}

/**
 * The annotation of a dictionary (its `.ann` file): plain text, in one section or, if the
 * file has `#LANGUAGE "Name"` lines, in one section per language.
 *
 * Plain data. This is also what plugins receive as `DictionaryContext.annotation`.
 *
 * @experimental
 */
export interface Annotation {
  /** The sections in file order; empty if the file has no text and no `#LANGUAGE` line. */
  readonly sections: readonly AnnotationSection[];
  /**
   * Convenience: the text of the first section, which is the whole annotation when there is
   * only one; empty if there are no sections. Use `sections` to choose by language.
   */
  readonly text: string;
}

/**
 * Options of {@link parseAnnotation}: those of `decodeDsl` (encoding detection, `.dz`
 * decompression, `diagnostics`, `strict`).
 *
 * @experimental
 */
export type ParseAnnotationOptions = DecodeOptions;

/**
 * Parses the annotation file of a dictionary (`.ann`).
 *
 * The file is decoded like a DSL file (encoding detection by BOM and heuristics, `.dz`
 * and gzip, newline normalization; there is no header to read a code page from, so 8-bit
 * input is read as `defaultEncoding`). A line that starts with `#LANGUAGE` begins a new
 * section; its value is the text between the first and the last double quote, as in the
 * directives of a DSL header (`DSL2002` if it has no quotes), and is resolved with
 * `resolveLanguageName` (`DSL2005` if unknown, `DSL2007` if not exact). Without such lines the
 * whole file is one section. The text is not interpreted in any other way.
 *
 * @example
 * ```ts
 * const { sections, text } = await parseAnnotation(bytes);
 * sections.map((s) => s.language?.iso639_1 ?? s.name);
 * ```
 *
 * @returns The annotation. Problems are reported as diagnostics; see the `diagnostics` and
 * `strict` options.
 * @throws DslError for invalid arguments (`DSL0001`, `DSL1002`, `DSL1003`), unreadable
 * input (`DSL1001`) or, in strict mode, a diagnostic of severity `error`.
 * @experimental
 */
export async function parseAnnotation(
  source: DslSource,
  options: ParseAnnotationOptions = {},
): Promise<Annotation> {
  const decoded = decodeDsl(source, options);
  const sink = options.strict ? createStrictSink(options.diagnostics) : options.diagnostics;
  const report = (diagnostic: Diagnostic): void => sink?.report(diagnostic);
  const chunks: string[] = [];
  for await (const chunk of decoded) chunks.push(chunk);
  return splitSections(chunks.join(''), report);
}

/** A section being collected. */
interface Draft {
  name?: string;
  language?: LanguageInfo;
  readonly lines: string[];
}

function splitSections(text: string, report: (diagnostic: Diagnostic) => void): Annotation {
  const sections: AnnotationSection[] = [];
  let draft: Draft | undefined;
  const finish = (): void => {
    if (draft === undefined) return;
    const body = trimSection(draft.lines.join('\n'));
    // Text before the first #LANGUAGE line is a section only if there is any.
    if (draft.name !== undefined || body.length > 0) {
      const section: { -readonly [K in keyof AnnotationSection]: AnnotationSection[K] } = {
        text: body,
      };
      if (draft.name !== undefined) section.name = draft.name;
      if (draft.language !== undefined) section.language = draft.language;
      sections.push(section);
    }
    draft = undefined;
  };
  let offset = 0;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    if (isLanguageLine(line)) {
      finish();
      const position = { offset, line: index + 1, column: 1 };
      const { value } = parseDirective(line, position, report);
      draft = { name: value, lines: [] };
      const match = resolveLanguageName(value);
      if (match === undefined) {
        report(
          createDiagnostic('unknownLanguage', `#LANGUAGE names an unknown language: "${value}".`, {
            position,
          }),
        );
      } else {
        draft.language = match.language;
        if (!match.exact) {
          report(
            createDiagnostic(
              'inexactLanguage',
              `#LANGUAGE "${value}" is not an exact Lingvo name; it is read as ` +
                `${match.language.name}, as GoldenDict does.`,
              { position },
            ),
          );
        }
      }
    } else {
      draft ??= { lines: [] };
      draft.lines.push(line);
    }
    offset += line.length + 1;
  }
  finish();
  return { sections, text: sections[0]?.text ?? '' };
}

/** `#LANGUAGE` at the start of a line, as a whole word, in any case. */
function isLanguageLine(line: string): boolean {
  return /^#language(?=[ \t"]|$)/i.test(line);
}

/** Removes blank lines at the start and whitespace at the end. */
function trimSection(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}
