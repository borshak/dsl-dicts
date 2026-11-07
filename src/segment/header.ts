/**
 * Header parsing: `#NAME "value"` directives at the start of a DSL file.
 *
 * @packageDocumentation
 */

import { resolveLanguageName } from '../data/languages.js';
import { createDiagnostic, type Diagnostic, type SourcePosition } from '../diagnostics/index.js';
import type { Directive, DslHeader } from './types.js';

/** Directives known to Lingvo or GoldenDict. Unknown ones are kept and reported as `info`. */
const KNOWN = new Set([
  'NAME',
  'INDEX_LANGUAGE',
  'CONTENTS_LANGUAGE',
  'SOURCE_CODE_PAGE',
  'INCLUDE',
  'ICON_FILE',
  'SOUND_DICTIONARY',
  // Annotation files only, and the undocumented forerunners of #NAME and #INDEX_LANGUAGE.
  'LANGUAGE',
  'FULL_NAME',
]);

const MANDATORY = [
  ['NAME', 'name', undefined],
  ['INDEX_LANGUAGE', 'indexLanguage', 'indexLanguageInfo'],
  ['CONTENTS_LANGUAGE', 'contentsLanguage', 'contentsLanguageInfo'],
] as const;

type Report = (diagnostic: Diagnostic) => void;

/** Whitespace in the DSL sense: space and tab only. */
export function isDslSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

/**
 * Parses a directive line (it starts with `#`).
 *
 * The name runs up to the first space, tab or double quote. The value is the text between the
 * first and the last quote, like in GoldenDict; without two quotes, the rest of the line.
 */
export function parseDirective(text: string, position: SourcePosition, report: Report): Directive {
  let end = 1;
  while (end < text.length) {
    const c = text.charCodeAt(end);
    if (isDslSpace(c) || c === 0x22) break;
    end++;
  }
  const name = text.slice(1, end);
  const raw = trimDslSpace(text.slice(end));
  const first = raw.indexOf('"');
  const last = raw.lastIndexOf('"');
  const quoted = first !== -1 && last > first;
  const value = quoted ? raw.slice(first + 1, last) : raw;
  if (name.length === 0) {
    report(createDiagnostic('malformedDirective', 'The directive has no name.', { position }));
  } else if (!quoted) {
    report(
      createDiagnostic(
        'malformedDirective',
        `The value of #${name} is not enclosed in double quotes.`,
        { position },
      ),
    );
  }
  return { name, raw, value, position };
}

/** Collects the directives of the header and checks them. */
export class HeaderBuilder {
  private readonly directives: Directive[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly report: Report) {}

  add(text: string, position: SourcePosition): void {
    const directive = parseDirective(text, position, this.report);
    this.directives.push(directive);
    const key = directive.name.toUpperCase();
    if (directive.name.length === 0) return;
    if (this.seen.has(key)) {
      this.report(
        createDiagnostic(
          'duplicateDirective',
          `The directive #${directive.name} is repeated; the first one is used.`,
          { position },
        ),
      );
    } else {
      this.seen.add(key);
    }
    if (!KNOWN.has(key)) {
      this.report(
        createDiagnostic('unknownDirective', `Unknown directive #${directive.name}.`, {
          position,
        }),
      );
    }
  }

  /** Finishes the header: reports missing mandatory directives and unknown languages. */
  build(): DslHeader {
    const header: { -readonly [K in keyof DslHeader]: DslHeader[K] } = {
      directives: this.directives,
    };
    for (const [name, field, infoField] of MANDATORY) {
      const directive = this.directives.find((d) => d.name.toUpperCase() === name);
      if (directive === undefined) {
        this.report(createDiagnostic('missingDirective', `The header has no #${name} directive.`));
        continue;
      }
      header[field] = directive.value;
      if (infoField === undefined) continue;
      const match = resolveLanguageName(directive.value);
      if (match === undefined) {
        this.report(
          createDiagnostic(
            'unknownLanguage',
            `#${directive.name} names an unknown language: "${directive.value}".`,
            { position: directive.position },
          ),
        );
        continue;
      }
      header[infoField] = match.language;
      if (!match.exact) {
        this.report(
          createDiagnostic(
            'inexactLanguage',
            `#${directive.name} "${directive.value}" is not an exact Lingvo name; it is read ` +
              `as ${match.language.name}, as GoldenDict does.`,
            { position: directive.position },
          ),
        );
      }
    }
    return header;
  }
}

/** Removes leading and trailing spaces and tabs. A trailing space escaped with `\` is kept. */
export function trimDslSpace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isDslSpace(text.charCodeAt(start))) start++;
  while (end > start && isDslSpace(text.charCodeAt(end - 1))) end--;
  if (end < text.length && end > start && isEscaped(text, end)) end++;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** Whether the character at `index` is escaped by an odd run of backslashes before it. */
function isEscaped(text: string, index: number): boolean {
  let count = 0;
  while (index - count - 1 >= 0 && text.charCodeAt(index - count - 1) === 0x5c) count++;
  return count % 2 === 1;
}
