/**
 * File naming rules of a dictionary and its companion files.
 *
 * @packageDocumentation
 */

import { basename } from 'node:path';

/** Extensions of a main dictionary file, longest first. Compared case-insensitively. */
const DICTIONARY_EXTENSIONS = ['.dsl.dz', '.dsl.gz', '.dsl'];

/** The kinds of companion files, with the suffixes (after the base name) they may have. */
export const COMPANION_SUFFIXES = {
  // Uncompressed before compressed; the exact spellings first, then any other case.
  abbreviations: ['_abrv.dsl', '_abrv.dsl.dz'],
  annotation: ['.ann'],
  icon: ['.bmp'],
  media: ['.dsl.files.zip'],
} as const;

/** A kind of companion file. */
export type CompanionKind = keyof typeof COMPANION_SUFFIXES;

/**
 * The base name of a dictionary file, from which the names of its companion files are made.
 *
 * - `foo.dsl`, `foo.dsl.dz` and `foo.dsl.gz` give `foo`, in any case of the extension
 *   (`FOO.DSL.DZ` gives `FOO`).
 * - Any other name loses its last extension, if it has one (`foo.txt` gives `foo`,
 *   `foo.bar.txt` gives `foo.bar`); a name without one, or a dot file, is its own base name.
 * - Directories are ignored: pass a file name or a path.
 *
 * @example
 * ```ts
 * dictionaryBaseName('/dicts/en-ru.dsl.dz'); // 'en-ru'
 * ```
 *
 * @experimental
 */
export function dictionaryBaseName(path: string): string {
  const name = basename(path);
  const lower = name.toLowerCase();
  for (const extension of DICTIONARY_EXTENSIONS) {
    if (lower.endsWith(extension) && name.length > extension.length) {
      return name.slice(0, -extension.length);
    }
  }
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Whether a file name is a main dictionary file (`.dsl`, `.dsl.dz`, `.dsl.gz`). */
export function isDictionaryName(name: string): boolean {
  const lower = name.toLowerCase();
  return DICTIONARY_EXTENSIONS.some((e) => lower.endsWith(e) && name.length > e.length);
}

/** Whether a file name is an abbreviations file (`<base>_abrv.dsl`, `.dsl.dz`, any case). */
export function isAbbreviationsName(name: string): boolean {
  const lower = name.toLowerCase();
  return COMPANION_SUFFIXES.abbreviations.some((s) => lower.endsWith(s));
}

const fold = (name: string): string => name.normalize('NFC').toLowerCase();

/**
 * Finds the companion file of a kind among the names of a directory.
 *
 * A name matches if it is the base name plus one of the kind's suffixes, in any case (and any
 * Unicode normalization form). Of several matches the first wins, by: the suffix (see
 * `COMPANION_SUFFIXES`), then the spelling (as in the table, then upper case, then any
 * other), then the name.
 */
export function findCompanion(
  names: readonly string[],
  base: string,
  kind: CompanionKind,
): string | undefined {
  const suffixes: readonly string[] = COMPANION_SUFFIXES[kind];
  const wanted = suffixes.map((suffix) => fold(base + suffix));
  const nfcBase = base.normalize('NFC');
  let best: { name: string; rank: [number, number] } | undefined;
  for (const name of names) {
    const index = wanted.indexOf(fold(name));
    if (index === -1) continue;
    const suffix = suffixes[index] as string;
    const nfc = name.normalize('NFC');
    const spelling = nfc === nfcBase + suffix ? 0 : nfc === nfcBase + suffix.toUpperCase() ? 1 : 2;
    const rank: [number, number] = [index, spelling];
    if (
      best === undefined ||
      rank[0] < best.rank[0] ||
      (rank[0] === best.rank[0] &&
        (rank[1] < best.rank[1] || (rank[1] === best.rank[1] && name < best.name)))
    ) {
      best = { name, rank };
    }
  }
  return best?.name;
}
