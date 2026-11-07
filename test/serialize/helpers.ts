/**
 * Test helpers for serialization. Web-standard APIs only.
 */

import { type DslSource, parseDsl } from '../../src/index.js';
import { HEADER } from '../segment/helpers.js';

export { HEADER };

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** The text of a dictionary, with the test header. */
export const TEXT = `${HEADER}cat\n\t[m1][p]n[/p] [trn]кошка[/trn]\ndog\n\t[m1][trn]собака[/trn]\n`;

/** A dictionary whose entries have diagnostics (unknown tag, unclosed tag). */
export const NOISY = `${HEADER}a\n\t[b]x\nb\n\t[zzz]y[/zzz]\nc\n\tfine\n`;

export function dictOf(text: string, diagnostics?: { report(d: never): void }) {
  return parseDsl(text, diagnostics === undefined ? {} : { diagnostics: diagnostics as never });
}

/** A source of bytes in small chunks that counts how many were read. */
export function countingSource(
  text: string,
  size: number,
): { source: DslSource; read: () => number; total: number } {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.slice(offset, offset + size));
  }
  let read = 0;
  return {
    source: (async function* () {
      for (const chunk of chunks) {
        read++;
        yield chunk;
      }
    })(),
    read: () => read,
    total: chunks.length,
  };
}
