/**
 * The markup AST: what `parseMarkup` and `parseBody` return, and what plugins consume.
 *
 * Design rules, which keep the schema stable:
 * - Plain data only: no classes, no methods, no cycles, no shared mutable state. Every tree
 *   is JSON-serializable and survives `structuredClone`.
 * - Nodes are discriminated by `type`. A tag is a generic `tag` node whatever its name, so a
 *   new or unknown tag never changes the schema; its meaning comes from the tag registry
 *   (`getTagSpec`).
 * - Escapes are resolved and meta characters are interpreted, but nothing is substituted
 *   that the parser cannot know: `~` stays a `tilde` node, links keep their raw target text.
 * - Positions (`position`, `end`) are optional: they are present unless the parser was asked
 *   to leave them out.
 *
 * @packageDocumentation
 */

import type { SourcePosition } from '../diagnostics/index.js';

/**
 * Version of the AST schema. It changes only when a change could break a consumer: a node
 * type or field is removed or changes meaning. Adding optional fields, node types or tag
 * names does not change it.
 *
 * @experimental
 */
export const AST_VERSION = 1;

/**
 * Where a node is in the source. Both fields are absent when positions are switched off.
 *
 * @experimental
 */
export interface NodeLocation {
  /** Position of the node's first character in the source, e.g. the `[` of a tag. */
  readonly position?: SourcePosition;
  /**
   * Position just after the node's last character, e.g. after the `]` of its closing tag.
   * For an implicitly closed node, the place where it was closed.
   */
  readonly end?: SourcePosition;
}

/**
 * Plain text with escapes resolved: `\[` is `[`, `[[` is `[`, an escaped space is U+00A0
 * (except inside `[s]` and `[video]`, where it stays a space). Never empty, never contains a
 * newline. Adjacent text is always merged into one node.
 *
 * @experimental
 */
export interface TextNode extends NodeLocation {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Attributes of a tag, typed by the tag's attribute schema in the registry. Only the fields
 * that apply to the tag are set; unknown tags have none (see `rawAttrs`). Values are kept even
 * when they are unknown (an unknown color or language), with a diagnostic.
 *
 * @experimental
 */
export interface TagAttributes {
  /** `[m]`, `[m0]`..`[m9]`: the margin level; 0 for a bare `[m]`. */
  readonly level?: number;
  /** `[c name]`: the color name; absent for a bare `[c]` (the viewer's default color). */
  readonly color?: string;
  /** `[lang id=1033]`: a Windows LCID or a legacy Lingvo id (1-30). */
  readonly id?: number;
  /** `[lang name="English"]`: a Lingvo language name (case-sensitive). */
  readonly name?: string;
  /** `[ref dict="..."]`: the name of the dictionary the link points to. */
  readonly dict?: string;
  /** `[ref target="..."]`, `[url target="..."]` (undocumented): the link target. */
  readonly target?: string;
}

/**
 * A tag and its content: `[b]...[/b]`, `[m2]...`, `[lang id=1033]...[/lang]`.
 *
 * `[m]` tags are block-level: they are always children of the body or of a sub-entry, never
 * of another tag (see the recovery rules of `parseBody`).
 *
 * @experimental
 */
export interface TagNode extends NodeLocation {
  readonly type: 'tag';
  /**
   * The registry name (`b`, `c`, `!trs`, `'`); `m` for `[m]` and `[m0]`..`[m9]`. Unknown tags
   * keep the name as written, case included.
   */
  readonly name: string;
  /** Parsed attributes; an empty object if none. */
  readonly attrs: TagAttributes;
  /**
   * The attribute text as written, between the name and the `]`, without surrounding spaces
   * and with escapes unresolved; absent if empty. Unknown tags have only this.
   */
  readonly rawAttrs?: string;
  readonly children: readonly MarkupNode[];
}

/**
 * A line break: between two body lines (`origin: 'line'`), or a `[br]` tag (`'tag'`).
 *
 * A `line` break separates two lines of content. There is none before the first content of
 * the body or of a sub-entry, after the last, around a sub-entry, or before an `[m]` tag,
 * which starts a new paragraph by itself.
 *
 * @experimental
 */
export interface LineBreakNode extends NodeLocation {
  readonly type: 'lineBreak';
  readonly origin: 'line' | 'tag';
}

/**
 * A `<<target>>` link to another entry of the same dictionary. The children hold the target
 * as written: `text` and `tilde` nodes only (other markup inside a link is kept as text).
 *
 * @experimental
 */
export interface LinkNode extends NodeLocation {
  readonly type: 'link';
  readonly children: readonly MarkupNode[];
}

/**
 * `~`: the entry's headword. `^~` is the headword with the case of its first character
 * flipped (`flipCase`). The markup parser does not substitute it; projections do. (In a
 * headword's `text` and `variants` it is substituted; see {@link Headword}.)
 *
 * @experimental
 */
export interface TildeNode extends NodeLocation {
  readonly type: 'tilde';
  readonly flipCase: boolean;
}

/**
 * A sub-entry, `@ headword` ... `@`, at the place where it occurs in the parent's markup: it
 * nests inside the tags that are open at that point (typically an `[m]` tag).
 *
 * @experimental
 */
export interface SubentryNode extends NodeLocation {
  readonly type: 'subentry';
  /**
   * The headwords, one per `@ headword` line, at least one. A `~` in them stands for the
   * parent entry's headword: it stays a `tilde` node in `display` and is substituted in `text`
   * and `variants` (see {@link Headword}).
   */
  readonly headwords: readonly Headword[];
  readonly children: readonly MarkupNode[];
}

/**
 * A parsed headword: of an entry, or of a sub-entry.
 *
 * Headword syntax (DSL manual, with GoldenDict's behavior where the manual is silent):
 * - `(...)` is an optional part: the headword has a form with it and one without it.
 *   `colo(u)r(s)` has four forms. Groups may follow each other and nest.
 * - `{...}` is the unsortable part: shown in the card, but not part of any index form. Tags
 *   are only allowed there (`{[']}a{[/']}` stresses the sortable `a`); a tag outside braces is
 *   parsed all the same, with a diagnostic.
 * - `\x` makes any character literal, `\(`, `\{` and `\~` included.
 * - `~` and `^~` stand for another headword (see `text`); `^` is literal otherwise.
 *
 * Plain data, like every AST node.
 *
 * @experimental
 */
export interface Headword extends NodeLocation {
  /**
   * The headword as written: comments removed, without leading and trailing spaces and tabs
   * (an escaped trailing space is kept). `position` and `end` delimit it.
   */
  readonly raw: string;
  /**
   * The headword as shown in the card title: markup nodes with the braces removed but their
   * content kept, parentheses kept as text, escapes resolved and tags parsed by the rules of
   * `parseMarkup`. `~` stays a `tilde` node.
   */
  readonly display: readonly MarkupNode[];
  /**
   * The plain text of `display`: text without tags, `~` substituted, a `[br]` as a space;
   * runs of spaces and tabs collapsed to one space, and trimmed. Parentheses and the
   * unsortable part are included.
   */
  readonly text: string;
  /**
   * The index forms: what the headword is listed, sorted and searched under. Every
   * combination of the optional parts, in a deterministic order (each part left out before
   * it is included, the leftmost part varying slowest: `color`, `colors`, `colour`,
   * `colours`). Without the unsortable part and tags, with escapes resolved and `~`
   * substituted, spaces and tabs collapsed and trimmed; empty forms and duplicates are
   * removed. Empty when the headword has no sortable text (`DSL3201`).
   *
   * Limits: a headword whose sortable text is longer than 500 characters is not expanded
   * (its only form keeps the parentheses as text, `DSL3202`), and at most 256 combinations
   * are generated (`DSL3203`).
   *
   * `~` stands for the first index form of the entry's first headword: in a sub-entry's
   * headwords, and in an entry's headwords after the first (as GoldenDict does). `^~` is the
   * same with the case of its first character flipped. A `~` with nothing to stand for (in
   * an entry's first headword) is kept as `~` (`DSL3102`).
   */
  readonly variants: readonly string[];
}

/**
 * Any node of the markup AST.
 *
 * @experimental
 */
export type MarkupNode = TextNode | TagNode | LineBreakNode | LinkNode | TildeNode | SubentryNode;

/**
 * A node that has children.
 *
 * @experimental
 */
export type ParentNode = TagNode | LinkNode | SubentryNode;

/**
 * Makes every property of a type read-only, recursively. AST types are already read-only; this
 * helper is for plugins that build their own types from them.
 *
 * @experimental
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * Tells whether a node has children.
 *
 * @experimental
 */
export function isParentNode(node: MarkupNode): node is ParentNode {
  return node.type === 'tag' || node.type === 'link' || node.type === 'subentry';
}
