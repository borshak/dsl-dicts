/**
 * Test helpers for the documentation examples. Web-standard APIs only.
 */

import { afterEach, beforeEach, type MockInstance, vi } from 'vitest';

/** The arguments of each `console.log` call of the test that is running. */
export function captureLog(): { readonly calls: () => readonly unknown[][] } {
  let log: MockInstance<typeof console.log> | undefined;
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    log?.mockRestore();
  });
  return { calls: () => log?.mock.calls ?? [] };
}

/** A code block of a document, with the marker on the line before it. */
export interface MarkedBlock {
  /** `example`, `block`, `legacy`, or `undefined` without a marker. */
  readonly kind: string | undefined;
  readonly name: string | undefined;
  /** The info string of the fence, e.g. `ts`. */
  readonly language: string;
  readonly content: string;
  /** Line number of the opening fence (one-based). */
  readonly line: number;
}

const MARKER = /^<!-- (example|block|legacy)(?:: ([\w.-]+))? -->$/;

/** The code blocks of a document, with their markers. */
export function blocksOf(text: string): MarkedBlock[] {
  const lines = text.split('\n');
  const blocks: MarkedBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(.*)$/.exec(lines[i] as string);
    if (open === null) continue;
    const end = lines.indexOf(open[1] as string, i + 1);
    if (end === -1) throw new Error(`Unclosed code block at line ${i + 1}`);
    const marker = MARKER.exec(lines[i - 1] ?? '');
    blocks.push({
      kind: marker?.[1],
      name: marker?.[2],
      language: (open[2] as string).trim(),
      content: lines.slice(i + 1, end).join('\n'),
      line: i + 1,
    });
    i = end;
  }
  return blocks;
}

/** The content of the code block after `<!-- block: name -->` in a document. */
export function blockOf(text: string, name: string): string {
  const block = blocksOf(text).find((b) => b.kind === 'block' && b.name === name);
  if (block === undefined) throw new Error(`No block ${name}`);
  return block.content;
}

/** The items of an async iterable, in an array. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const list: T[] = [];
  for await (const item of iterable) list.push(item);
  return list;
}
