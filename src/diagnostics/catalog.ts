/**
 * Catalog of diagnostic codes: the single source of truth for codes, default severities and
 * one-line summaries. Documentation is generated from this table.
 *
 * Code ranges, one per layer:
 * - `DSL0xxx`: general API usage.
 * - `DSL1xxx`: input, decompression and encoding detection.
 * - `DSL2xxx`: line segmentation (header, cards, sub-entries, comments).
 * - `DSL3xxx`: headwords.
 * - `DSL4xxx`: body markup.
 * - `DSL5xxx`: plugins. `DSL50xx` are failures of a plugin, always thrown as a `DslError` that
 *   names the plugin; `DSL51xx` are diagnostics that plugins report through
 *   `DictionaryContext.diagnostics`.
 * - `DSL6xxx`: companion files. `DSL60xx` are problems with the content of an abbreviations
 *   file (`parseAbbreviations`); `DSL61xx` are problems with finding or reading the files
 *   next to a dictionary (`dsl-dicts/node`).
 * - `DSL7xxx`: serialization. All are thrown as a `DslError`: a JSONL document that is not
 *   readable by this version (`readJsonl`), or output that cannot be serialized (`toJsonl`).
 *
 * Codes are stable: once released, a code keeps its meaning and is never reused.
 *
 * @packageDocumentation
 */

/** Severity of a diagnostic. */
export type Severity = 'error' | 'warning' | 'info';

/** Catalog entry of one diagnostic code. */
export interface DiagnosticSpec {
  /** Stable code, `DSL` followed by four digits. */
  readonly code: string;
  /** Severity used when the code is reported. */
  readonly severity: Severity;
  /** One-line description of the problem. */
  readonly summary: string;
  /**
   * The code is never reported to a diagnostic sink: it is only thrown as a `DslError`
   * (usage errors, unreadable input, missing runtime features).
   */
  readonly thrown?: true;
}

/**
 * All diagnostic codes, keyed by a symbolic name used in the source code.
 *
 * @experimental
 */
export const DIAGNOSTICS = {
  invalidArgument: {
    code: 'DSL0001',
    severity: 'error',
    summary: 'An argument or option has an invalid type or value.',
    thrown: true,
  },
  alreadyConsumed: {
    code: 'DSL0002',
    severity: 'error',
    summary: 'A single-use result was iterated more than once.',
    thrown: true,
  },
  cancelled: {
    code: 'DSL0003',
    severity: 'error',
    summary: 'Processing was cancelled before the requested result was available.',
    thrown: true,
  },

  readFailed: {
    code: 'DSL1001',
    severity: 'error',
    summary: 'Reading the input source failed; the original error is the cause.',
    thrown: true,
  },
  unknownEncoding: {
    code: 'DSL1002',
    severity: 'error',
    summary: 'The encoding option is neither a Lingvo code page name nor a known encoding label.',
    thrown: true,
  },
  unsupportedEncoding: {
    code: 'DSL1003',
    severity: 'error',
    summary: 'The encoding is known but this runtime cannot decode it.',
    thrown: true,
  },
  decompressionUnavailable: {
    code: 'DSL1004',
    severity: 'error',
    summary: 'The input is gzip-compressed but this runtime has no DecompressionStream.',
    thrown: true,
  },
  decompressionFailed: {
    code: 'DSL1101',
    severity: 'error',
    summary:
      'The gzip data is invalid, truncated, has trailing data or several members; decoding stops.',
  },
  bomMismatch: {
    code: 'DSL1201',
    severity: 'warning',
    summary: 'The byte order mark contradicts the forced encoding and is decoded as text.',
  },
  unknownCodePage: {
    code: 'DSL1202',
    severity: 'warning',
    summary: 'The #SOURCE_CODE_PAGE value is not recognized; the default encoding is used.',
  },
  unusableCodePage: {
    code: 'DSL1203',
    severity: 'warning',
    summary:
      'The #SOURCE_CODE_PAGE encoding is unsupported by this runtime or not ASCII-compatible; ' +
      'the default encoding is used.',
  },
  codePageIgnored: {
    code: 'DSL1204',
    severity: 'info',
    summary: 'The #SOURCE_CODE_PAGE directive is ignored because a BOM or UTF-16 was detected.',
  },
  codePageOverridden: {
    code: 'DSL1205',
    severity: 'warning',
    summary: 'The #SOURCE_CODE_PAGE directive is ignored because the content is valid UTF-8.',
  },
  replacementCharacter: {
    code: 'DSL1206',
    severity: 'warning',
    summary:
      'The decoded text contains U+FFFD: the input is probably malformed for the chosen ' +
      'encoding. Reported once per input.',
  },

  missingDirective: {
    code: 'DSL2001',
    severity: 'warning',
    summary: 'A mandatory directive (#NAME, #INDEX_LANGUAGE or #CONTENTS_LANGUAGE) is missing.',
  },
  malformedDirective: {
    code: 'DSL2002',
    severity: 'warning',
    summary:
      'A directive has no name or its value is not enclosed in double quotes; the value is ' +
      'taken as is.',
  },
  duplicateDirective: {
    code: 'DSL2003',
    severity: 'warning',
    summary: 'A directive occurs more than once in the header; the first occurrence is used.',
  },
  unknownDirective: {
    code: 'DSL2004',
    severity: 'info',
    summary: 'A header directive is not known; it is kept as is.',
  },
  unknownLanguage: {
    code: 'DSL2005',
    severity: 'warning',
    summary:
      'A language directive names a language unknown to Lingvo, even read leniently as ' +
      'GoldenDict does (see DSL2007).',
  },
  misplacedDirective: {
    code: 'DSL2006',
    severity: 'warning',
    summary: 'A line starting with # after the header is ignored; escape it as \\# for a headword.',
  },
  inexactLanguage: {
    code: 'DSL2007',
    severity: 'info',
    summary:
      'A language directive names a Lingvo language inexactly (case, or without an ending ' +
      'such as ModernSort); it is resolved as GoldenDict does.',
  },
  unclosedComment: {
    code: 'DSL2101',
    severity: 'error',
    summary: 'A {{ comment is not closed: it swallows the rest of the input.',
  },
  orphanBodyLine: {
    code: 'DSL2201',
    severity: 'warning',
    summary: 'An indented line before the first headword is ignored.',
  },
  blankLineAfterHeadword: {
    code: 'DSL2202',
    severity: 'warning',
    summary: 'Blank lines between headwords or between the headwords and the body are skipped.',
  },
  blankLineInBody: {
    code: 'DSL2203',
    severity: 'warning',
    summary: 'Blank lines inside a body are skipped; the body goes on after them.',
  },
  missingBody: {
    code: 'DSL2204',
    severity: 'warning',
    summary: 'The input ends after headwords without a body; the entry has an empty body.',
  },
  unclosedSubentry: {
    code: 'DSL2301',
    severity: 'warning',
    summary:
      'A sub-entry is not closed by a lone @ before the next sub-entry or the end of the entry.',
  },
  strayEndOfSubentry: {
    code: 'DSL2302',
    severity: 'warning',
    summary: 'A lone @ closes no open sub-entry.',
  },

  unclosedBrace: {
    code: 'DSL3001',
    severity: 'warning',
    summary: 'A { in a headword is not closed: the rest of the headword is unsortable.',
  },
  strayBrace: {
    code: 'DSL3002',
    severity: 'warning',
    summary: 'A } in a headword closes no {; it is ignored.',
  },
  unclosedParenthesis: {
    code: 'DSL3003',
    severity: 'warning',
    summary: 'A ( in a headword is not closed: the optional part runs to the end of the headword.',
  },
  strayParenthesis: {
    code: 'DSL3004',
    severity: 'warning',
    summary:
      'A ) in a headword closes no (; it is shown but ignored in the index forms. Escape it ' +
      'as \\) for a literal parenthesis.',
  },
  markupOutsideBraces: {
    code: 'DSL3101',
    severity: 'warning',
    summary:
      'A headword has a tag or link outside the unsortable part {...}, where Lingvo forbids ' +
      'them; it is parsed, and its text is part of the index forms. Reported once per headword.',
  },
  unresolvedTilde: {
    code: 'DSL3102',
    severity: 'warning',
    summary:
      'A ~ in a headword has no headword to stand for (it is in the first headword of an ' +
      "entry, or the parent's headwords are not known); it is kept as text in the index forms.",
  },
  emptyHeadword: {
    code: 'DSL3201',
    severity: 'warning',
    summary: 'A headword has no sortable text, so no index form: it is all unsortable or empty.',
  },
  headwordTooLong: {
    code: 'DSL3202',
    severity: 'warning',
    summary:
      'The sortable text of a headword is longer than 500 characters: its optional parts are ' +
      'not expanded (as in GoldenDict) and the parentheses are kept.',
  },
  tooManyVariants: {
    code: 'DSL3203',
    severity: 'warning',
    summary: 'A headword expands to more than 256 index forms; only the first 256 are kept.',
  },

  unterminatedTag: {
    code: 'DSL4001',
    severity: 'warning',
    summary: 'A [ has no closing ] on its line, or another [ comes first; it is kept as text.',
  },
  malformedTag: {
    code: 'DSL4002',
    severity: 'warning',
    summary:
      'A tag has no name, does not start right after the bracket, or has a backslash in its ' +
      'name ([], [/], [ b]); it is kept as text.',
  },
  danglingEscape: {
    code: 'DSL4003',
    severity: 'info',
    summary: 'A backslash at the end of a line escapes nothing; it is kept as text.',
  },
  strayCaret: {
    code: 'DSL4004',
    severity: 'info',
    summary:
      'A ^ is not followed by a character or ~ whose case it could change; it is kept as text.',
  },
  unclosedLink: {
    code: 'DSL4005',
    severity: 'warning',
    summary: 'A << is not closed by >> on its line; it is kept as text.',
  },
  emptyLink: {
    code: 'DSL4006',
    severity: 'warning',
    summary: 'A <<>> link has no target; it is kept as text.',
  },
  unknownTag: {
    code: 'DSL4101',
    severity: 'warning',
    summary:
      'A tag name is not in the registry (names are lowercase); it is kept as a tag because a ' +
      'matching closing tag follows.',
  },
  unknownTagAsText: {
    code: 'DSL4102',
    severity: 'info',
    summary:
      'An unknown tag name without a matching closing tag, or an unknown closing tag without an ' +
      'opening one, is kept as text.',
  },
  unexpectedAttributes: {
    code: 'DSL4103',
    severity: 'warning',
    summary: 'A tag that takes no attributes, or a closing tag, has attributes; they are ignored.',
  },
  invalidAttribute: {
    code: 'DSL4104',
    severity: 'warning',
    summary: 'An attribute is malformed, repeated or not valid for its tag; it is ignored.',
  },
  missingAttribute: {
    code: 'DSL4105',
    severity: 'warning',
    summary: 'A mandatory attribute is missing: [lang] needs id or name.',
  },
  unknownAttributeValue: {
    code: 'DSL4106',
    severity: 'warning',
    summary:
      'An attribute value is unknown (a color name, language id or language name); it is kept.',
  },
  inexactLanguageName: {
    code: 'DSL4107',
    severity: 'info',
    summary:
      'A [lang name="..."] names a Lingvo language inexactly (case, or without an ending such ' +
      'as ModernSort); the name is kept as written and resolveLanguageName resolves it.',
  },
  strayClosingTag: {
    code: 'DSL4201',
    severity: 'warning',
    summary: 'A closing tag matches no open tag of the entry or sub-entry; it is ignored.',
  },
  unclosedTag: {
    code: 'DSL4202',
    severity: 'warning',
    summary:
      'A tag other than [m] is still open at the end of its entry, sub-entry or text; it is ' +
      'closed there.',
  },
  crossedTags: {
    code: 'DSL4203',
    severity: 'info',
    summary:
      'Tags overlap, as in [b][i]x[/b]y[/i]: the tags opened inside are closed and reopened ' +
      'after the closing tag. Common in real dictionaries and rendered as intended.',
  },
  nestedSameTag: {
    code: 'DSL4204',
    severity: 'warning',
    summary: 'A tag is opened inside a tag of the same name; it is nested.',
  },
  tagInPlainText: {
    code: 'DSL4205',
    severity: 'warning',
    summary:
      'A tag or link inside a text-only tag ([t], [s], [video], [ref], [url]) or inside a <<>> ' +
      'link is kept as text.',
  },
  misplacedTag: {
    code: 'DSL4206',
    severity: 'warning',
    summary: 'A tag is outside the tags it is valid in ([preview] outside [s] and [video]).',
  },
  nestingTooDeep: {
    code: 'DSL4207',
    severity: 'warning',
    summary: 'Tags are nested more than 64 levels deep; the extra opening tag is kept as text.',
  },

  pluginSetupFailed: {
    code: 'DSL5001',
    severity: 'error',
    summary:
      "A plugin's setup threw or did not return a function; the original error is the cause.",
    thrown: true,
  },
  pluginFailed: {
    code: 'DSL5002',
    severity: 'error',
    summary:
      'A plugin threw while processing an entry; the original error is the cause, and the ' +
      "error has the plugin's name and the entry's position.",
    thrown: true,
  },
  pluginDiagnostic: {
    code: 'DSL5101',
    severity: 'warning',
    summary:
      'A plugin reports a problem with an entry or the dictionary; the message names the ' +
      'plugin, and the plugin may set any severity.',
  },

  duplicateAbbreviation: {
    code: 'DSL6001',
    severity: 'warning',
    summary:
      'An abbreviation is defined more than once in the abbreviations file; the first ' +
      'definition is used.',
  },
  emptyAbbreviation: {
    code: 'DSL6002',
    severity: 'warning',
    summary: 'An abbreviation has no expansion (its body has no text); it is skipped.',
  },
  companionUnreadable: {
    code: 'DSL6101',
    severity: 'warning',
    summary:
      'A companion file of the dictionary (abbreviations, annotation) or its directory could ' +
      'not be read or decoded; it is ignored and the original error is the cause.',
  },
  companionMissing: {
    code: 'DSL6102',
    severity: 'warning',
    summary: 'A companion file named explicitly in the options does not exist; it is ignored.',
  },

  invalidJsonl: {
    code: 'DSL7001',
    severity: 'error',
    summary:
      'The input is not a dsl-dicts JSONL document: the header record is missing or malformed, ' +
      'or its format is not dsl-dicts/jsonl.',
    thrown: true,
  },
  unsupportedFormatVersion: {
    code: 'DSL7002',
    severity: 'error',
    summary: 'The major version of the JSONL format is not one this version can read.',
    thrown: true,
  },
  unsupportedAstVersion: {
    code: 'DSL7003',
    severity: 'error',
    summary: 'The AST version of the JSONL document differs from the one the reader expects.',
    thrown: true,
  },
  unsupportedPlugin: {
    code: 'DSL7004',
    severity: 'error',
    summary:
      'The plugin of the JSONL document differs from the one the reader expects, by name or ' +
      'by major version of its output format.',
    thrown: true,
  },
  invalidRecord: {
    code: 'DSL7005',
    severity: 'error',
    summary: 'A JSONL record is not valid JSON, not an object, or has no type.',
    thrown: true,
  },
  notSerializable: {
    code: 'DSL7006',
    severity: 'error',
    summary: 'An entry or the output of a plugin cannot be serialized to JSON.',
    thrown: true,
  },
} as const satisfies Record<string, DiagnosticSpec>;

/** Symbolic name of a diagnostic, e.g. `unknownCodePage`. */
export type DiagnosticName = keyof typeof DIAGNOSTICS;

/** Stable diagnostic code, e.g. `DSL1202`. */
export type DiagnosticCode = (typeof DIAGNOSTICS)[DiagnosticName]['code'];

const BY_CODE: ReadonlyMap<string, DiagnosticSpec> = new Map(
  Object.values(DIAGNOSTICS).map((spec) => [spec.code, spec]),
);

/**
 * Finds the catalog entry of a code.
 *
 * @returns The entry, or `undefined` if the code is not in the catalog.
 * @experimental
 */
export function findDiagnosticSpec(code: string): DiagnosticSpec | undefined {
  return BY_CODE.get(code);
}
