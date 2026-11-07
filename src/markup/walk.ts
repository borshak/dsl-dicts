/**
 * A small depth-first walker over the markup AST, for plugins and projections.
 *
 * @packageDocumentation
 */

import { type Headword, isParentNode, type MarkupNode, type ParentNode } from './ast.js';

/**
 * What a visitor returns: nothing to go on, `'skip'` to leave out the node's children (from
 * `enter` only), `'stop'` to end the walk.
 */
export type WalkResult = undefined | 'skip' | 'stop';

/**
 * Callbacks of {@link walk} and {@link walkEntry}. `parent` is `undefined` for the nodes of
 * the top-level array, and `index` is the index of the node in its array.
 */
export interface Visitor {
  /** Called before the node's children. */
  enter?(node: MarkupNode, parent: ParentNode | undefined, index: number): WalkResult;
  /** Called after the node's children (also for nodes without children). */
  leave?(node: MarkupNode, parent: ParentNode | undefined, index: number): WalkResult;
}

/**
 * Visits every node of a markup tree in document order, depth first. A function is the same
 * as a visitor with only `enter`. The tree must not be modified during the walk.
 *
 * Only `children` are walked: the headwords of a sub-entry (`SubentryNode.headwords`) are not,
 * and neither are those of an entry, which are not in its body. Use {@link walkEntry} to
 * visit their `display` nodes too.
 *
 * @returns `false` if a callback stopped the walk, else `true`.
 */
export function walk(
  nodes: readonly MarkupNode[],
  visitor: Visitor | NonNullable<Visitor['enter']>,
): boolean {
  return walkNodes(nodes, undefined, callbacksOf(visitor), false);
}

/**
 * Visits every node of an entry: the `display` nodes of its headwords, in order, then its
 * body, as {@link walk} does, except that the `display` nodes of each sub-entry's headwords
 * are visited too, after `enter` of the sub-entry and before its children. For nodes at the
 * top level of a `display`, `parent` is `undefined` and `index` is their index in it.
 *
 * @example
 * ```ts
 * // Every language of the entry, headwords included.
 * walkEntry(entry, (node) => {
 *   if (node.type === 'tag' && node.name === 'lang') languages.add(node.attrs.language);
 *   return undefined;
 * });
 * ```
 *
 * @returns `false` if a callback stopped the walk, else `true`.
 */
export function walkEntry(
  entry: { readonly headwords: readonly Headword[]; readonly body: readonly MarkupNode[] },
  visitor: Visitor | NonNullable<Visitor['enter']>,
): boolean {
  const callbacks = callbacksOf(visitor);
  return (
    walkHeadwords(entry.headwords, callbacks) && walkNodes(entry.body, undefined, callbacks, true)
  );
}

function callbacksOf(visitor: Visitor | NonNullable<Visitor['enter']>): Visitor {
  return typeof visitor === 'function' ? { enter: visitor } : visitor;
}

function walkHeadwords(headwords: readonly Headword[], visitor: Visitor): boolean {
  for (const headword of headwords) {
    if (!walkNodes(headword.display, undefined, visitor, true)) return false;
  }
  return true;
}

function walkNodes(
  nodes: readonly MarkupNode[],
  parent: ParentNode | undefined,
  visitor: Visitor,
  headwords: boolean,
): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as MarkupNode;
    const result = visitor.enter?.(node, parent, i);
    if (result === 'stop') return false;
    if (result !== 'skip' && isParentNode(node)) {
      if (headwords && node.type === 'subentry' && !walkHeadwords(node.headwords, visitor)) {
        return false;
      }
      if (!walkNodes(node.children, node, visitor, headwords)) return false;
    }
    if (visitor.leave?.(node, parent, i) === 'stop') return false;
  }
  return true;
}
