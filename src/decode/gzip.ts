/**
 * gzip detection and decompression with `DecompressionStream`.
 *
 * @packageDocumentation
 */

import { createDiagnostic, type Diagnostic, DslError } from '../diagnostics/index.js';

/**
 * Decompression mode.
 *
 * - `auto`: decompress if the input starts with the gzip magic bytes `1F 8B`.
 * - `gzip`: the input must be gzip; anything else is reported as `DSL1101`.
 * - `none`: never decompress.
 *
 * @experimental
 */
export type DecompressMode = 'auto' | 'gzip' | 'none';

/** Reads chunks until at least `count` bytes are available or the input ends. */
async function peek(
  iterator: AsyncIterator<Uint8Array>,
  count: number,
): Promise<{ head: Uint8Array[]; bytes: Uint8Array; done: boolean }> {
  const head: Uint8Array[] = [];
  let length = 0;
  while (length < count) {
    const result = await iterator.next();
    if (result.done) return { head, bytes: concat(head, length), done: true };
    head.push(result.value);
    length += result.value.length;
  }
  return { head, bytes: concat(head, length), done: false };
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** What {@link decompress} found out; updated as the input is read. */
export interface DecompressStatus {
  /** The input is gzip data. */
  compressed: boolean;
  /** Decompression failed (`DSL1101`): the output ends early, maybe inside a character. */
  failed: boolean;
}

/**
 * Decompresses gzip input (including dictzip `.dz`, which is valid gzip).
 *
 * Runtimes disagree on input with several gzip members or trailing bytes: some decode every
 * member or ignore trailing zeros, others fail. Neither is supported. Every decompression
 * failure (corrupt or truncated data, bad checksum, trailing data) is reported as `DSL1101`;
 * decompression then stops, and the bytes decompressed before the failure are kept.
 */
export async function* decompress(
  chunks: AsyncIterable<Uint8Array>,
  mode: DecompressMode,
  report: (diagnostic: Diagnostic) => void,
  status: DecompressStatus,
): AsyncGenerator<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();
  let finished = false;
  try {
    const { head, bytes, done } =
      mode === 'none' ? { head: [], bytes: undefined, done: false } : await peek(iterator, 2);
    const isGzip = bytes !== undefined && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!isGzip) {
      if (mode === 'gzip') {
        finished = done;
        status.failed = true;
        report(
          createDiagnostic('decompressionFailed', 'The input is not gzip data.', { byteOffset: 0 }),
        );
        return;
      }
      yield* head;
      if (done) {
        finished = true;
        return;
      }
      for (;;) {
        const result = await iterator.next();
        if (result.done) {
          finished = true;
          return;
        }
        yield result.value;
      }
    }
    status.compressed = true;
    if (typeof DecompressionStream !== 'function') {
      throw DslError.of(
        'decompressionUnavailable',
        'The input is gzip-compressed, but this runtime has no DecompressionStream.',
      );
    }
    // From here on, gunzip owns the iterator and closes it.
    finished = true;
    yield* gunzip(head, done, iterator, report, status);
  } finally {
    if (!finished) await iterator.return?.();
  }
}

async function* gunzip(
  head: readonly Uint8Array[],
  done: boolean,
  iterator: AsyncIterator<Uint8Array>,
  report: (diagnostic: Diagnostic) => void,
  status: DecompressStatus,
): AsyncGenerator<Uint8Array> {
  let sourceError: unknown;
  let sourceDone = done;
  let pending = [...head];
  const compressed = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = pending.shift();
      if (next !== undefined) {
        controller.enqueue(next);
        return;
      }
      if (sourceDone) {
        controller.close();
        return;
      }
      try {
        const result = await iterator.next();
        if (result.done) {
          sourceDone = true;
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        sourceError = error;
        sourceDone = true;
        controller.error(error);
      }
    },
    cancel() {
      pending = [];
    },
  });
  const reader = compressed
    .pipeThrough(new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader();
  let total = 0;
  let readerDone = false;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        readerDone = true;
        if (sourceError !== undefined) throw sourceError;
        status.failed = true;
        report(
          createDiagnostic(
            'decompressionFailed',
            `Decompression failed after ${total} bytes: the gzip data is corrupt or truncated, ` +
              'has trailing bytes, or has several members (unsupported).',
            { byteOffset: total, cause: error },
          ),
        );
        return;
      }
      if (result.done) {
        readerDone = true;
        return;
      }
      total += result.value.length;
      yield result.value;
    }
  } finally {
    if (!readerDone) await reader.cancel().catch(() => {});
    reader.releaseLock();
    if (!sourceDone) await iterator.return?.();
  }
}
