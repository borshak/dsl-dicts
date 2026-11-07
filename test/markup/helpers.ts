/**
 * Test helpers for the markup layer, including a test-only serializer from the AST back to
 * canonical DSL markup. Web-standard APIs only.
 */

import {
  createCollectingSink,
  type Diagnostic,
  type MarkupNode,
  type MarkupOptions,
  parseBody,
  parseMarkup,
  type RawEntry,
} from '../../src/index.js';

export interface Parsed {
  readonly nodes: MarkupNode[];
  readonly diagnostics: readonly Diagnostic[];
  readonly codes: readonly string[];
}

/** Parses markup without positions, collecting diagnostics. */
export function parse(text: string, options: MarkupOptions = {}): Parsed {
  const sink = createCollectingSink();
  const nodes = parseMarkup(text, { positions: false, ...options, diagnostics: sink });
  return { nodes, diagnostics: sink.diagnostics, codes: sink.diagnostics.map((d) => d.code) };
}

/** Parses a body without positions, collecting diagnostics. */
export function parseEntry(entry: RawEntry, options: MarkupOptions = {}): Parsed {
  const sink = createCollectingSink();
  const nodes = parseBody(entry, { positions: false, ...options, diagnostics: sink });
  return { nodes, diagnostics: sink.diagnostics, codes: sink.diagnostics.map((d) => d.code) };
}

/**
 * A compact, readable form of a tree: `text` for text, `name(children)` for tags, `<<...>>`
 * for links, `~` / `^~`, `/` for a line break between lines, `[br]`, `@{hw|...}(children)`.
 */
export function show(nodes: readonly MarkupNode[]): string {
  return nodes.map(showNode).join(' ');
}

function showNode(node: MarkupNode): string {
  switch (node.type) {
    case 'text':
      return JSON.stringify(node.text);
    case 'tag': {
      const attrs = Object.entries(node.attrs).map(([k, v]) => `${k}=${v}`);
      const head = attrs.length > 0 ? `${node.name}{${attrs.join(',')}}` : node.name;
      return `${head}(${show(node.children)})`;
    }
    case 'lineBreak':
      return node.origin === 'line' ? '/' : '[br]';
    case 'link':
      return `<<${show(node.children)}>>`;
    case 'tilde':
      return node.flipCase ? '^~' : '~';
    case 'subentry':
      return `@{${node.headwords.map((h) => h.text).join('|')}}(${show(node.children)})`;
  }
}

/** Removes positions (`position`, `end`, `segments`) from a tree, recursively. */
export function stripPositions<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripPositions) as T;
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'position' || key === 'end' || key === 'segments') continue;
    out[key] = stripPositions(item);
  }
  return out as T;
}

const META = /[\\[\]~^<>@]/g;

/**
 * Serializes nodes back to canonical DSL markup: every metacharacter in text is escaped,
 * every tag is closed explicitly, `[m]` is written with its level, and a line break between
 * lines is a `\n`. Sub-entries are not supported here; see {@link serializeBody}.
 */
export function serialize(nodes: readonly MarkupNode[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.text.replace(META, '\\$&');
        break;
      case 'tag': {
        const name = node.name === 'm' ? `m${node.attrs.level ?? 0}` : node.name;
        const attrs = node.rawAttrs === undefined ? '' : ` ${node.rawAttrs}`;
        out += `[${name}${attrs}]${serialize(node.children)}[/${node.name}]`;
        break;
      }
      case 'lineBreak':
        out += node.origin === 'tag' ? '[br]' : '\n';
        break;
      case 'link':
        out += `<<${serialize(node.children)}>>`;
        break;
      case 'tilde':
        out += node.flipCase ? '^~' : '~';
        break;
      case 'subentry':
        throw new Error('serialize() does not support sub-entries');
    }
  }
  return out;
}

/** Serializes a body, sub-entries included, to the indented lines of an entry. */
export function serializeBody(nodes: readonly MarkupNode[]): string {
  const lines: string[] = [''];
  const newLine = () => {
    if (lines[lines.length - 1] !== '') lines.push('');
  };
  const write = (text: string) => {
    lines[lines.length - 1] += text;
  };
  const visit = (list: readonly MarkupNode[]) => {
    for (const node of list) {
      switch (node.type) {
        case 'subentry':
          newLine();
          for (const headword of node.headwords) {
            write(`@ ${headword.text}`);
            lines.push('');
          }
          visit(node.children);
          newLine();
          write('@');
          lines.push('');
          break;
        case 'lineBreak':
          if (node.origin === 'line') lines.push('');
          else write('[br]');
          break;
        case 'tag': {
          const name = node.name === 'm' ? `m${node.attrs.level ?? 0}` : node.name;
          const attrs = node.rawAttrs === undefined ? '' : ` ${node.rawAttrs}`;
          write(`[${name}${attrs}]`);
          visit(node.children);
          write(`[/${node.name}]`);
          break;
        }
        default:
          write(serialize([node]));
      }
    }
  };
  visit(nodes);
  return lines
    .filter((line) => line !== '')
    .map((line) => `\t${line}\n`)
    .join('');
}
