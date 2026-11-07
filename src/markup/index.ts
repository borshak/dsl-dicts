/**
 * Markup layer: the AST of DSL markup, its parser and a walker.
 *
 * @packageDocumentation
 */

export {
  AST_VERSION,
  type DeepReadonly,
  isParentNode,
  type LineBreakNode,
  type LinkNode,
  type MarkupNode,
  type NodeLocation,
  type ParentNode,
  type SubentryNode,
  type TagAttributes,
  type TagNode,
  type TextNode,
  type TildeNode,
} from './ast.js';
export { type MarkupOptions, type ParseMarkupOptions, parseBody, parseMarkup } from './parse.js';
export { type Visitor, type WalkResult, walk } from './walk.js';
