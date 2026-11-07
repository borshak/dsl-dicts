/**
 * A small depth-first walker over the markup AST, for plugins and projections.
 *
 * @packageDocumentation
 */

import { isParentNode, type MarkupNode, type ParentNode } from './ast.js';

/**
 * What a visitor returns: nothing to go on, `'skip'` to leave out the node's children (from
 * `enter` only), `'stop'` to end the walk.
 *
 * @experimental
 */
export type WalkResult = undefined | 'skip' | 'stop';

/**
 * Callbacks of {@link walk}. `parent` is `undefined` for the nodes of the top-level array.
 *
 * @experimental
 */
export interface Visitor {
  /** Called before the node's children. */
  enter?(node: MarkupNode, parent: ParentNode | undefined, index: number): WalkResult;
  /** Called after the node's children (also for nodes without children). */
  leave?(node: MarkupNode, parent: ParentNode | undefined, index: number): WalkResult;
}

/**
 * Visits every node in document order, depth first. A function is the same as a visitor with
 * only `enter`. The tree must not be modified during the walk.
 *
 * @returns `false` if a callback stopped the walk, else `true`.
 * @experimental
 */
export function walk(
  nodes: readonly MarkupNode[],
  visitor: Visitor | NonNullable<Visitor['enter']>,
): boolean {
  const callbacks: Visitor = typeof visitor === 'function' ? { enter: visitor } : visitor;
  return walkNodes(nodes, undefined, callbacks);
}

function walkNodes(
  nodes: readonly MarkupNode[],
  parent: ParentNode | undefined,
  visitor: Visitor,
): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as MarkupNode;
    const result = visitor.enter?.(node, parent, i);
    if (result === 'stop') return false;
    if (result !== 'skip' && isParentNode(node) && !walkNodes(node.children, node, visitor)) {
      return false;
    }
    if (visitor.leave?.(node, parent, i) === 'stop') return false;
  }
  return true;
}
