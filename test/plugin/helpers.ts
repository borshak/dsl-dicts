/**
 * Test helpers for plugins. Web-standard APIs only.
 */

import { type DslEntry, type ParseDslOptions, parseDsl } from '../../src/index.js';
import { HEADER } from '../segment/helpers.js';

export { HEADER };

/** The error a function throws synchronously. */
export function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error');
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** Freezes a value and everything reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

/** Parses a dictionary (the test header is prepended) into deeply frozen entries. */
export async function entriesOf(
  entries: string,
  options: ParseDslOptions & { readonly body?: 'ast' } = {},
): Promise<DslEntry[]> {
  const list = await collect(
    parseDsl(HEADER + entries, { positions: false, ...options }).entries(),
  );
  return list.map(deepFreeze);
}

/** The single entry of a one-entry dictionary, deeply frozen. */
export async function entryOf(text: string): Promise<DslEntry> {
  const [entry, ...rest] = await entriesOf(text);
  if (entry === undefined || rest.length > 0) throw new Error('Expected exactly one entry.');
  return entry;
}
