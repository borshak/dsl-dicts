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
import type { RawLine } from '../segment/index.js';

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
 * flipped (`flipCase`). The parser does not substitute it; projections do.
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
  /** The headword lines, unparsed: the text after the `@`, trimmed, with its positions. */
  readonly headwords: readonly RawLine[];
  readonly children: readonly MarkupNode[];
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
