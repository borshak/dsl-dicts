/**
 * Minimal registry of DSL tags.
 *
 * Sources: the DSL manual by Anatoly (https://anatoly.dev/dsl-manual/) and the Mostitsky DSL
 * Reference (https://github.com/yozhic/DSL-Reference, `tag_*.html`). Tag names are lowercase
 * only; Lingvo rejects `[B]`.
 *
 * Not tags, hence not in the registry:
 * - `<<target>>` is a link syntax (a reference to another entry of the same dictionary). It is
 *   delimited by double angle brackets, has no closing tag, and may not contain other tags.
 * - Meta characters and commands such as `~`, `^`, `@`, `\`, `{...}`, `(...)`, `{{...}}`, `#`.
 *
 * Pure data and lookup helpers: no side effects, tree-shakeable.
 *
 * @packageDocumentation
 */

/**
 * Functional group of a tag.
 *
 * @experimental The tag registry may gain fields and values in a minor version.
 */
export type TagKind =
  /** Text formatting: bold, color, margin, ... */
  | 'format'
  /** Dictionary structure: labels, transcription, secondary text. */
  | 'structure'
  /** Search indexing zones: examples, comments, translations, index exclusion. */
  | 'zone'
  /** Language markup. */
  | 'lang'
  /** Links to entries and external addresses. */
  | 'link'
  /** Multimedia files. */
  | 'media'
  /** Service tags. Reserved: none of the documented tags is a service tag. */
  | 'service';

/**
 * Attribute schema of a tag.
 *
 * - `none`: no attributes.
 * - `color`: optional color name, `[c red]` (bare `[c]` uses the label color of the viewer).
 * - `level`: optional margin level 0-9 encoded in the tag name, `[m3]`.
 * - `lang`: `id=<number>` or `name="<LingvoName>"`.
 * - `ref`: optional `dict="<dictionary name>"` or undocumented `target="<headword>"`.
 * - `url`: optional undocumented `target="<address>"`.
 *
 * @experimental The tag registry may gain fields and values in a minor version.
 */
export type TagAttrs = 'none' | 'color' | 'level' | 'lang' | 'ref' | 'url';

/**
 * Origin of a tag.
 *
 * @experimental The tag registry may gain fields and values in a minor version.
 */
export type TagDialect =
  /** Documented by ABBYY Lingvo. */
  | 'lingvo'
  /** Extension specific to GoldenDict. Reserved: none of the registered tags is one. */
  | 'goldendict'
  /** Understood by the Lingvo compiler but absent from its documentation. */
  | 'undocumented';

/**
 * Description of one DSL tag, from the registry behind the parser.
 *
 * @experimental The tag registry may gain fields and values in a minor version.
 */
export interface TagSpec {
  /** Tag name without brackets, e.g. `b`, `m`, `lang`, `!trs`, `'`. */
  readonly name: string;
  /** Functional group. */
  readonly kind: TagKind;
  /** Has a closing tag (`[br]` does not). */
  readonly paired: boolean;
  /** The closing tag may be omitted (`[m]`/`[mN]`: the zone ends at the next `[m...]`). */
  readonly closeOptional?: boolean;
  /** Attribute schema; absent means `none`. */
  readonly attrs?: TagAttrs;
  /** The attribute is mandatory (`[lang]` is only valid with `id` or `name`). */
  readonly attrsRequired?: boolean;
  /** May appear in headwords; there it must be wrapped in `{...}` (the non-sortable part). */
  readonly allowedInHeadword?: boolean;
  /** Content is plain text: other tags are forbidden inside (`[t]`, `[s]`, `[ref]`, `[url]`). */
  readonly noNestedTags?: boolean;
  /** Only valid directly inside one of these tags. */
  readonly parents?: readonly string[];
  /** Origin; absent means `lingvo`. */
  readonly dialect?: TagDialect;
  /** One-line description. */
  readonly description: string;
}

/**
 * All registered tags.
 *
 * `[m]` and `[m0]`..`[m9]` are one spec named `m` with the `level` attribute: the level is the
 * digit that follows the name in the opening tag. `[m]` means no level (shift 0; discouraged),
 * `[m3]` means level 3. Use {@link getTagSpec} and {@link getMarginLevel} to resolve such names.
 */
export const TAGS: readonly TagSpec[] = [
  {
    name: 'b',
    kind: 'format',
    paired: true,
    description: 'Bold text. Body only; any tags may be nested.',
  },
  {
    name: 'i',
    kind: 'format',
    paired: true,
    description: 'Italic text. Body only; any tags may be nested.',
  },
  {
    name: 'u',
    kind: 'format',
    paired: true,
    description: 'Underlined text. Body only; any tags may be nested.',
  },
  {
    name: 'c',
    kind: 'format',
    paired: true,
    attrs: 'color',
    allowedInHeadword: true,
    description:
      'Colored text: bare `[c]` uses the label color, `[c name]` a lowercase HTML color name.',
  },
  {
    name: 'sup',
    kind: 'format',
    paired: true,
    allowedInHeadword: true,
    description:
      'Superscript. Accepted in headwords but not recommended (only the position changes).',
  },
  {
    name: 'sub',
    kind: 'format',
    paired: true,
    allowedInHeadword: true,
    description:
      'Subscript. Accepted in headwords but not recommended (only the position changes).',
  },
  {
    name: 'm',
    kind: 'format',
    paired: true,
    closeOptional: true,
    attrs: 'level',
    description:
      'Paragraph margin: `[m]` or `[m0]`..`[m9]`; opening it starts a new line; zone ends at the next `[m...]`.',
  },
  {
    name: "'",
    kind: 'format',
    paired: true,
    allowedInHeadword: true,
    description: "Stressed vowel: `[']` and `[/']`. Not allowed inside `[ref]` or `<<...>>`.",
  },
  {
    name: 'br',
    kind: 'format',
    paired: false,
    allowedInHeadword: true,
    dialect: 'undocumented',
    description: 'Line break; has no closing tag.',
  },
  {
    name: 'p',
    kind: 'structure',
    paired: true,
    allowedInHeadword: true,
    description: 'Label (abbreviation); excluded from the index and not affected by outer styling.',
  },
  {
    name: 't',
    kind: 'structure',
    paired: true,
    noNestedTags: true,
    allowedInHeadword: true,
    dialect: 'undocumented',
    description: 'Transcription; rendered in a special font, other tags are forbidden inside.',
  },
  {
    name: '*',
    kind: 'structure',
    paired: true,
    allowedInHeadword: true,
    description: 'Secondary text that the viewer can hide; `[c]` has no effect next to it.',
  },
  {
    name: 'ex',
    kind: 'zone',
    paired: true,
    description: 'Indexing zone of examples; body only.',
  },
  {
    name: 'com',
    kind: 'zone',
    paired: true,
    description: 'Indexing zone of comments; body only.',
  },
  {
    name: 'trn',
    kind: 'zone',
    paired: true,
    description: 'Indexing zone of translations; body only.',
  },
  {
    name: 'trn1',
    kind: 'zone',
    paired: true,
    dialect: 'undocumented',
    description: 'Compiler-generated variant of `[trn]`; must not be written by hand.',
  },
  {
    name: '!trs',
    kind: 'zone',
    paired: true,
    description: 'Excludes a fragment from the index; only valid inside `[ex]`/`[com]`/`[trn]`.',
  },
  {
    name: 'lang',
    kind: 'lang',
    paired: true,
    attrs: 'lang',
    attrsRequired: true,
    description: 'Language of the text: `[lang id=1033]` or `[lang name="English"]`; body only.',
  },
  {
    name: 's',
    kind: 'media',
    paired: true,
    noNestedTags: true,
    allowedInHeadword: true,
    description: 'Media file (sound, image, video); contains only a bare file name.',
  },
  {
    name: 'video',
    kind: 'media',
    paired: true,
    noNestedTags: true,
    allowedInHeadword: true,
    dialect: 'undocumented',
    description: 'Video file; behaves exactly like `[s]`.',
  },
  {
    name: 'preview',
    kind: 'media',
    paired: true,
    parents: ['s', 'video'],
    dialect: 'undocumented',
    description:
      'Preview of a media file; only valid inside `[s]`/`[video]`, has no visible effect.',
  },
  {
    name: 'ref',
    kind: 'link',
    paired: true,
    attrs: 'ref',
    noNestedTags: true,
    allowedInHeadword: true,
    description: 'Link to an entry of this or (with `dict="..."`) another dictionary; text only.',
  },
  {
    name: 'url',
    kind: 'link',
    paired: true,
    attrs: 'url',
    noNestedTags: true,
    allowedInHeadword: true,
    description: 'Link to an external address (web or e-mail); contains only the address.',
  },
] as const;

const BY_NAME: ReadonlyMap<string, TagSpec> = new Map(TAGS.map((t) => [t.name, t]));

/**
 * Returns the margin level of an `m0`..`m9` tag name.
 *
 * @returns 0-9, or `undefined` for a bare `m` and for any other name.
 */
export function getMarginLevel(name: string): number | undefined {
  if (name.length !== 2 || name.charCodeAt(0) !== 0x6d) return undefined;
  const digit = name.charCodeAt(1) - 0x30;
  return digit >= 0 && digit <= 9 ? digit : undefined;
}

/**
 * Finds the spec of a tag by its name as written between the brackets, without `/`.
 *
 * `m0`..`m9` resolve to the `m` spec. The lookup is case-sensitive.
 *
 * @returns The spec, or `undefined` if the tag is unknown.
 * @experimental The tag registry may gain fields and values in a minor version.
 */
export function getTagSpec(name: string): TagSpec | undefined {
  return BY_NAME.get(name) ?? (getMarginLevel(name) === undefined ? undefined : BY_NAME.get('m'));
}
