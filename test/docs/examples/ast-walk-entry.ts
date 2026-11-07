import { type DslEntry, getTagSpec, walkEntry } from 'dsl-dicts';

/** The links of an entry: `<<target>>` and `[ref]`, with their target text. */
export function linksOf(entry: DslEntry): string[] {
  const links: string[] = [];
  walkEntry(entry, (node) => {
    if (node.type === 'link' || (node.type === 'tag' && getTagSpec(node.name)?.kind === 'link')) {
      const parts = node.children.map((child) => (child.type === 'text' ? child.text : '~'));
      links.push(parts.join(''));
      return 'skip'; // the target is the whole content
    }
    return undefined;
  });
  return links;
}
