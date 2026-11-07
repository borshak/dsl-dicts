import { parseDsl } from 'dsl-dicts';

/** Counts the entries of a dictionary of any size, in constant memory. */
export async function countEntries(file: Blob): Promise<number> {
  // Give up after a minute: the iteration then rejects with a DslError DSL0003.
  const dict = parseDsl(file, { positions: false, signal: AbortSignal.timeout(60_000) });
  let count = 0;
  for await (const batch of dict.batches()) count += batch.length;
  return count;
}
