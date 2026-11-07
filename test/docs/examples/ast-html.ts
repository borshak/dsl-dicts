import type { MarkupNode } from 'dsl-dicts';

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Renders markup as simple HTML. `tilde` is the headword the entry gives for `~`. */
export function toHtml(nodes: readonly MarkupNode[], tilde: string): string {
  let html = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        html += escapeHtml(node.text);
        break;
      case 'tilde':
        html += escapeHtml(tilde);
        break;
      case 'lineBreak':
        html += '<br>';
        break;
      case 'link':
        html += `<a class="entry">${toHtml(node.children, tilde)}</a>`;
        break;
      case 'subentry':
        html += `<div class="subentry">${toHtml(node.children, tilde)}</div>`;
        break;
      case 'tag': {
        const inner = toHtml(node.children, tilde);
        if (node.name === 'b' || node.name === 'i' || node.name === 'u') {
          html += `<${node.name}>${inner}</${node.name}>`;
        } else if (node.name === 'm') {
          html += `<p class="m${node.attrs.level ?? 0}">${inner}</p>`;
        } else if (node.name !== 's' && node.name !== 'video') {
          html += inner; // any other tag, known or not: its content
        }
        break;
      }
      default:
        // A node type added in a later minor version: skip it.
        break;
    }
  }
  return html;
}
