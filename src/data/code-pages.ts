/**
 * Code page names accepted by `#SOURCE_CODE_PAGE`, and the canonical WHATWG encoding names.
 *
 * Lingvo names an 8-bit code page by script (`#SOURCE_CODE_PAGE "Cyrillic"`). The first seven
 * entries are the documented ones. `Hebrew` and `Vietnamese` follow the same naming pattern,
 * but no source confirms that Lingvo accepts them; they are marked `verified: false`.
 *
 * Pure data and lookup helpers: no side effects, tree-shakeable.
 *
 * @packageDocumentation
 */

/** A Lingvo code page name and the encoding it stands for. */
export interface LingvoCodePage {
  /** Lingvo name as documented, e.g. `EasternEuropean`. */
  readonly name: string;
  /** Canonical WHATWG encoding name, e.g. `windows-1250`. */
  readonly encoding: string;
  /** `false` when no source confirms that Lingvo accepts the name. */
  readonly verified: boolean;
}

/** Lingvo code page names, ordered by name. */
export const LINGVO_CODE_PAGES: readonly LingvoCodePage[] = [
  { name: 'Arabic', encoding: 'windows-1256', verified: true },
  { name: 'Baltic', encoding: 'windows-1257', verified: true },
  { name: 'Cyrillic', encoding: 'windows-1251', verified: true },
  { name: 'EasternEuropean', encoding: 'windows-1250', verified: true },
  { name: 'Greek', encoding: 'windows-1253', verified: true },
  { name: 'Hebrew', encoding: 'windows-1255', verified: false },
  { name: 'Latin', encoding: 'windows-1252', verified: true },
  { name: 'Turkish', encoding: 'windows-1254', verified: true },
  { name: 'Vietnamese', encoding: 'windows-1258', verified: false },
];

/** Lowercases and removes spaces, `_` and `-`: `Eastern_European` -> `easterneuropean`. */
function foldCodePageName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

const BY_FOLDED_NAME: ReadonlyMap<string, LingvoCodePage> = new Map(
  LINGVO_CODE_PAGES.map((page) => [foldCodePageName(page.name), page]),
);

/**
 * Finds a Lingvo code page by name. Unlike Lingvo, the lookup is lenient: case is ignored, and
 * so are spaces, `_` and `-` (`eastern european` finds `EasternEuropean`).
 *
 * @returns The code page, or `undefined` if the name is unknown.
 */
export function findLingvoCodePage(name: string): LingvoCodePage | undefined {
  return BY_FOLDED_NAME.get(foldCodePageName(name));
}

/**
 * Canonical names of all encodings of the WHATWG Encoding Standard, lowercased as
 * `TextDecoder.prototype.encoding` reports them. Used to tell an encoding the runtime does not
 * support from an unknown label; labels (aliases such as `cp1251`) are not listed.
 */
export const WHATWG_ENCODINGS: readonly string[] = [
  'utf-8',
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-8-i',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
  'gbk',
  'gb18030',
  'big5',
  'euc-jp',
  'iso-2022-jp',
  'shift_jis',
  'euc-kr',
  'replacement',
  'utf-16be',
  'utf-16le',
  'x-user-defined',
];
