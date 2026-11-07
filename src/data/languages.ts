/**
 * Languages accepted by ABBYY Lingvo in `#INDEX_LANGUAGE` / `#CONTENTS_LANGUAGE` / `#LANGUAGE`
 * (by name) and in `[lang name="..."]` / `[lang id=...]` (by name or numeric id).
 *
 * Sources (cross-checked):
 * - DSL manual by Anatoly (https://anatoly.dev/dsl-manual/), "Languages supported in Lingvo".
 *   Primary source for names, Windows LCIDs, legacy ids and the support status of each language.
 * - DSL Reference (https://github.com/yozhic/DSL-Reference, `langs.html`,
 *   `tag_handling.html`): same table, used to confirm the above.
 * - GoldenDict (https://github.com/goldendict/goldendict, `dsl_details.cc`, `dsl.cc`,
 *   `langcoder.cc`): the id-to-language table behind `[lang id=...]` handling. It confirms every
 *   LCID and legacy id below, including the quirky Kirgiz = 1595 and Latin = 1540.
 *
 * Known discrepancies between the sources:
 * - Names are case-sensitive in Lingvo (`English` is valid, `english` is a compiler error).
 *   GoldenDict is lenient: it case-folds the name and strips the endings `NewSpelling`,
 *   `Standard`, `ModernSort`, `TraditionalSort` and `PRC`. This table follows Lingvo; any
 *   leniency belongs in the consumer, not in the reference data.
 * - ISO 639-1 for Armenian: the manual (and GoldenDict) list `Am`, which is Amharic; the correct
 *   code is `hy`, which is what is stored here. GoldenDict maps Uzbek to `tz` (a typo); `uz` is
 *   stored here.
 * - ISO 639-2 column: the manual lists both bibliographic and terminologic codes (for example
 *   `deu, ger`) and a few misprints (`esl`, `dat`, `sve`). Only the ISO 639-3 code (which equals
 *   the terminologic 639-2 code) is stored. The manual gives the macrolanguage `nor` for both
 *   Norwegian variants; the specific codes `nob` and `nno` are stored.
 * - Latin: Lingvo up to DSL Compiler 15.0.511.0 accepts `id=1540` only; since 15.0.826.5 it
 *   accepts `id=1142` only. Both are resolved to Latin (1142 is canonical, 1540 is in `altLcids`).
 * - Kirgiz: Lingvo uses `1595`, not the Windows LCID `1088` of Kyrgyz.
 * - `ChinesePRC` is labeled "traditional" in the manual's Russian text; it is the PRC variant
 *   (`zh-CN`, LCID 2052), `Chinese` is the Taiwan variant (LCID 1028).
 * - Bashkir is accepted by `name` only (not by `id`) in DSL Compiler x5, although it has an LCID.
 *
 * Legacy ids (1-30) were used by Lingvo 8.0 and later as `[lang id=N]`; the LCIDs were
 * introduced in the Lingvo 11 documentation. Both are accepted by DSL Compiler x3 and x5. The
 * two ranges are disjoint (legacy ids are at most 30, LCIDs start at 1025), so
 * {@link findLanguageById} needs no precedence rule; a unit test enforces this.
 *
 * Pure data and lookup helpers: no side effects, tree-shakeable.
 *
 * @packageDocumentation
 */

/** How well a language is supported by Lingvo according to the manual. */
export type LanguageSupport =
  /** Listed in the Lingvo help. */
  | 'official'
  /** Works in the DSL compiler but is explicitly marked as unofficial by Lingvo documentation. */
  | 'unofficial'
  /** Works in the DSL compiler but is absent from the Lingvo help. */
  | 'undocumented';

/** A language known to ABBYY Lingvo. */
export interface LanguageInfo {
  /** Exact, case-sensitive Lingvo name, e.g. `SpanishModernSort`. */
  readonly name: string;
  /** Windows locale identifier (LCID), accepted by `[lang id=...]`. */
  readonly lcid: number;
  /** Additional LCIDs accepted for the same language by some compiler versions. */
  readonly altLcids?: readonly number[];
  /** Legacy Lingvo numeric id (1-30) used by old Lingvo versions; only for 30 languages. */
  readonly legacyId?: number;
  /** ISO 639-1 two-letter code (lowercase). */
  readonly iso639_1: string;
  /** ISO 639-3 three-letter code (lowercase). */
  readonly iso639_3: string;
  /** Support level according to the manual. */
  readonly support: LanguageSupport;
  /** Accepted by DSL Compiler x3/x5 but rejected by x6. */
  readonly removedInX6?: true;
}

/** All languages, ordered by Lingvo name. */
export const LANGUAGES: readonly LanguageInfo[] = [
  {
    name: 'Afrikaans',
    lcid: 1078,
    legacyId: 15,
    iso639_1: 'af',
    iso639_3: 'afr',
    support: 'official',
  },
  {
    name: 'Arabic',
    lcid: 1025,
    iso639_1: 'ar',
    iso639_3: 'ara',
    support: 'undocumented',
  },
  {
    name: 'Armenian',
    lcid: 1067,
    iso639_1: 'hy',
    iso639_3: 'hye',
    support: 'undocumented',
  },
  {
    name: 'ArmenianWestern',
    lcid: 32811,
    iso639_1: 'hy',
    iso639_3: 'hye',
    support: 'undocumented',
  },
  {
    name: 'AzeriLatin',
    lcid: 1068,
    iso639_1: 'az',
    iso639_3: 'aze',
    support: 'undocumented',
    removedInX6: true,
  },
  {
    name: 'Bashkir',
    lcid: 1133,
    iso639_1: 'ba',
    iso639_3: 'bak',
    support: 'unofficial',
  },
  {
    name: 'Basque',
    lcid: 1069,
    legacyId: 9,
    iso639_1: 'eu',
    iso639_3: 'eus',
    support: 'official',
  },
  {
    name: 'Belarusian',
    lcid: 1059,
    legacyId: 21,
    iso639_1: 'be',
    iso639_3: 'bel',
    support: 'official',
  },
  {
    name: 'Bulgarian',
    lcid: 1026,
    legacyId: 22,
    iso639_1: 'bg',
    iso639_3: 'bul',
    support: 'official',
  },
  {
    name: 'Chinese',
    lcid: 1028,
    legacyId: 29,
    iso639_1: 'zh',
    iso639_3: 'zho',
    support: 'official',
  },
  {
    name: 'ChinesePRC',
    lcid: 2052,
    legacyId: 28,
    iso639_1: 'zh',
    iso639_3: 'zho',
    support: 'official',
  },
  {
    name: 'Czech',
    lcid: 1029,
    legacyId: 18,
    iso639_1: 'cs',
    iso639_3: 'ces',
    support: 'official',
  },
  {
    name: 'Danish',
    lcid: 1030,
    legacyId: 13,
    iso639_1: 'da',
    iso639_3: 'dan',
    support: 'official',
  },
  {
    name: 'Dutch',
    lcid: 1043,
    legacyId: 10,
    iso639_1: 'nl',
    iso639_3: 'nld',
    support: 'official',
  },
  {
    name: 'English',
    lcid: 1033,
    legacyId: 1,
    iso639_1: 'en',
    iso639_3: 'eng',
    support: 'official',
  },
  {
    name: 'Estonian',
    lcid: 1061,
    iso639_1: 'et',
    iso639_3: 'est',
    support: 'undocumented',
  },
  {
    name: 'Finnish',
    lcid: 1035,
    legacyId: 11,
    iso639_1: 'fi',
    iso639_3: 'fin',
    support: 'official',
  },
  {
    name: 'French',
    lcid: 1036,
    legacyId: 4,
    iso639_1: 'fr',
    iso639_3: 'fra',
    support: 'official',
  },
  {
    name: 'Georgian',
    lcid: 1079,
    iso639_1: 'ka',
    iso639_3: 'kat',
    support: 'undocumented',
  },
  {
    name: 'German',
    lcid: 1031,
    legacyId: 3,
    iso639_1: 'de',
    iso639_3: 'deu',
    support: 'official',
  },
  {
    name: 'GermanNewSpelling',
    lcid: 32775,
    legacyId: 26,
    iso639_1: 'de',
    iso639_3: 'deu',
    support: 'official',
    removedInX6: true,
  },
  {
    name: 'Greek',
    lcid: 1032,
    iso639_1: 'el',
    iso639_3: 'ell',
    support: 'unofficial',
  },
  {
    name: 'Hungarian',
    lcid: 1038,
    legacyId: 19,
    iso639_1: 'hu',
    iso639_3: 'hun',
    support: 'official',
  },
  {
    name: 'Icelandic',
    lcid: 1039,
    iso639_1: 'is',
    iso639_3: 'isl',
    support: 'undocumented',
  },
  {
    name: 'Indonesian',
    lcid: 1057,
    legacyId: 16,
    iso639_1: 'id',
    iso639_3: 'ind',
    support: 'official',
  },
  {
    name: 'Italian',
    lcid: 1040,
    legacyId: 5,
    iso639_1: 'it',
    iso639_3: 'ita',
    support: 'official',
  },
  {
    name: 'Kazakh',
    lcid: 1087,
    iso639_1: 'kk',
    iso639_3: 'kaz',
    support: 'unofficial',
  },
  {
    name: 'Kirgiz',
    lcid: 1595,
    iso639_1: 'ky',
    iso639_3: 'kir',
    support: 'undocumented',
    removedInX6: true,
  },
  {
    name: 'Latin',
    lcid: 1142,
    altLcids: [1540],
    legacyId: 30,
    iso639_1: 'la',
    iso639_3: 'lat',
    support: 'official',
  },
  {
    name: 'Latvian',
    lcid: 1062,
    iso639_1: 'lv',
    iso639_3: 'lav',
    support: 'unofficial',
  },
  {
    name: 'Lithuanian',
    lcid: 1063,
    iso639_1: 'lt',
    iso639_3: 'lit',
    support: 'unofficial',
  },
  {
    name: 'Malay',
    lcid: 1086,
    iso639_1: 'ms',
    iso639_3: 'msa',
    support: 'undocumented',
  },
  {
    name: 'NorwegianBokmal',
    lcid: 1044,
    legacyId: 14,
    iso639_1: 'nb',
    iso639_3: 'nob',
    support: 'official',
  },
  {
    name: 'NorwegianNynorsk',
    lcid: 2068,
    legacyId: 25,
    iso639_1: 'nn',
    iso639_3: 'nno',
    support: 'official',
  },
  {
    name: 'Polish',
    lcid: 1045,
    legacyId: 20,
    iso639_1: 'pl',
    iso639_3: 'pol',
    support: 'official',
  },
  {
    name: 'PortugueseStandard',
    lcid: 2070,
    legacyId: 8,
    iso639_1: 'pt',
    iso639_3: 'por',
    support: 'official',
  },
  {
    name: 'Romanian',
    lcid: 1048,
    iso639_1: 'ro',
    iso639_3: 'ron',
    support: 'official',
  },
  {
    name: 'Russian',
    lcid: 1049,
    legacyId: 2,
    iso639_1: 'ru',
    iso639_3: 'rus',
    support: 'official',
  },
  {
    name: 'SerbianCyrillic',
    lcid: 3098,
    legacyId: 23,
    iso639_1: 'sr',
    iso639_3: 'srp',
    support: 'official',
  },
  {
    name: 'Slovak',
    lcid: 1051,
    iso639_1: 'sk',
    iso639_3: 'slk',
    support: 'unofficial',
  },
  {
    name: 'Slovenian',
    lcid: 1060,
    iso639_1: 'sl',
    iso639_3: 'slv',
    support: 'undocumented',
  },
  {
    name: 'SpanishModernSort',
    lcid: 3082,
    legacyId: 6,
    iso639_1: 'es',
    iso639_3: 'spa',
    support: 'official',
  },
  {
    name: 'SpanishTraditionalSort',
    lcid: 1034,
    legacyId: 7,
    iso639_1: 'es',
    iso639_3: 'spa',
    support: 'official',
  },
  {
    name: 'Swahili',
    lcid: 1089,
    legacyId: 17,
    iso639_1: 'sw',
    iso639_3: 'swa',
    support: 'official',
  },
  {
    name: 'Swedish',
    lcid: 1053,
    legacyId: 12,
    iso639_1: 'sv',
    iso639_3: 'swe',
    support: 'official',
  },
  {
    name: 'Tajik',
    lcid: 1064,
    iso639_1: 'tg',
    iso639_3: 'tgk',
    support: 'undocumented',
    removedInX6: true,
  },
  {
    name: 'Tatar',
    lcid: 1092,
    iso639_1: 'tt',
    iso639_3: 'tat',
    support: 'unofficial',
  },
  {
    name: 'Turkish',
    lcid: 1055,
    legacyId: 27,
    iso639_1: 'tr',
    iso639_3: 'tur',
    support: 'official',
  },
  {
    name: 'Turkmen',
    lcid: 1090,
    iso639_1: 'tk',
    iso639_3: 'tuk',
    support: 'undocumented',
    removedInX6: true,
  },
  {
    name: 'Ukrainian',
    lcid: 1058,
    legacyId: 24,
    iso639_1: 'uk',
    iso639_3: 'ukr',
    support: 'official',
  },
  {
    name: 'UzbekLatin',
    lcid: 1091,
    iso639_1: 'uz',
    iso639_3: 'uzb',
    support: 'undocumented',
    removedInX6: true,
  },
] as const;

const BY_NAME: ReadonlyMap<string, LanguageInfo> = new Map(LANGUAGES.map((l) => [l.name, l]));

const BY_ID: ReadonlyMap<number, LanguageInfo> = new Map(
  LANGUAGES.flatMap((l) => [
    [l.lcid, l] as const,
    ...(l.legacyId === undefined ? [] : [[l.legacyId, l] as const]),
    ...(l.altLcids ?? []).map((id) => [id, l] as const),
  ]),
);

/**
 * Finds a language by its exact, case-sensitive Lingvo name (`English`, not `english`).
 *
 * @returns The language, or `undefined` if the name is unknown.
 */
export function findLanguageByName(name: string): LanguageInfo | undefined {
  return BY_NAME.get(name);
}

/**
 * Finds a language by a numeric id as used in `[lang id=...]`: a Windows LCID (such as 1033),
 * an alternative LCID (such as 1540 for Latin) or a legacy Lingvo id (1-30).
 *
 * The ranges never overlap, so the result is unambiguous.
 *
 * @returns The language, or `undefined` if the id is unknown.
 */
export function findLanguageById(id: number): LanguageInfo | undefined {
  return BY_ID.get(id);
}

/**
 * Result of {@link resolveLanguageName}.
 */
export interface LanguageMatch {
  /** The language the name resolves to. */
  readonly language: LanguageInfo;
  /** The name is the exact Lingvo name; `false` if it was resolved leniently. */
  readonly exact: boolean;
}

/** Endings GoldenDict removes from language names before looking them up. */
const LENIENT_ENDINGS = ['newspelling', 'standard', 'modernsort', 'traditionalsort', 'prc'];

/** Lowercases a name and removes one GoldenDict ending, if something is left before it. */
function lenientKey(name: string): string {
  const key = name.toLowerCase();
  for (const ending of LENIENT_ENDINGS) {
    if (key.length > ending.length && key.endsWith(ending)) {
      return key.slice(0, -ending.length);
    }
  }
  return key;
}

const BY_LOWER_NAME: ReadonlyMap<string, LanguageInfo> = new Map(
  LANGUAGES.map((l) => [l.name.toLowerCase(), l]),
);

/** First language (in table order) for each lenient key. */
const BY_LENIENT_KEY: ReadonlyMap<string, LanguageInfo> = (() => {
  const map = new Map<string, LanguageInfo>();
  for (const l of LANGUAGES) {
    const key = lenientKey(l.name);
    if (!map.has(key)) map.set(key, l);
  }
  return map;
})();

/**
 * Finds a language by name, leniently, the way GoldenDict reads `#INDEX_LANGUAGE` and
 * `#CONTENTS_LANGUAGE`. In order of precedence:
 * 1. the exact, case-sensitive Lingvo name (`exact: true`);
 * 2. the name in any case, without surrounding whitespace: `english` is `English`;
 * 3. the name in any case, without one of the endings `NewSpelling`, `Standard`,
 *    `ModernSort`, `TraditionalSort` and `PRC` on either side: `Spanish` is
 *    `SpanishModernSort`, `Portuguese` is `PortugueseStandard`, `RussianStandard` is
 *    `Russian`. When several languages share the stem, the first one in table order wins
 *    (`German` before `GermanNewSpelling`, `SpanishModernSort` before
 *    `SpanishTraditionalSort`).
 *
 * Lingvo itself only accepts exact names; use {@link findLanguageByName} for that.
 *
 * @returns The language and whether the match was exact, or `undefined` if nothing matches.
 */
export function resolveLanguageName(name: string): LanguageMatch | undefined {
  const exact = BY_NAME.get(name);
  if (exact !== undefined) return { language: exact, exact: true };
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (trimmed.length === 0) return undefined;
  const language =
    BY_LOWER_NAME.get(trimmed.toLowerCase()) ?? BY_LENIENT_KEY.get(lenientKey(trimmed));
  return language === undefined ? undefined : { language, exact: false };
}
