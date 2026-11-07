/**
 * Input normalization: every supported source becomes an async sequence of byte chunks.
 *
 * @packageDocumentation
 */

import { DslError, dslError } from '../diagnostics/index.js';
import { onAbort } from './abort.js';

/**
 * Input accepted by the decoder.
 *
 * - `string`: already decoded text; only the BOM and newlines are handled.
 * - `Uint8Array`, `ArrayBuffer`: the whole file in memory.
 * - `Blob` (and `File`): read with `blob.stream()`.
 * - `ReadableStream<Uint8Array>`: e.g. `fetch(...).body`.
 * - `AsyncIterable<Uint8Array>`, `Iterable<Uint8Array>`: e.g. a Node.js readable stream.
 *
 * Chunks are not copied: do not modify a chunk after it has been produced.
 */
export type DslSource =
  | string
  | Uint8Array
  | ArrayBuffer
  | Blob
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>;

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

function readFailed(error: unknown): DslError {
  if (error instanceof DslError) return error;
  return dslError('readFailed', 'Reading the input failed.', error);
}

function checkChunk(value: unknown, index: number): Uint8Array {
  const bytes = asBytes(value);
  if (bytes === undefined) {
    throw dslError('invalidArgument', `Input chunk ${index} is not a Uint8Array.`);
  }
  return bytes;
}

/**
 * Wraps a source as an async sequence of byte chunks. Errors of the source become
 * `DslError` `DSL1001` with the original error as `cause`. Stopping early cancels the source,
 * and so does an abort of `signal`, even during a pending read (a stream is cancelled, an
 * iterator returned); the sequence then just ends: reporting the abort is the caller's job.
 *
 * @throws DslError `DSL0001` if `source` is not a supported type (synchronously).
 */
export function toByteChunks(
  source: Exclude<DslSource, string>,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  const bytes = asBytes(source);
  if (bytes !== undefined) return fromIterator(() => [bytes][Symbol.iterator](), signal);
  if (isArrayBuffer(source)) {
    const view = new Uint8Array(source);
    return fromIterator(() => [view][Symbol.iterator](), signal);
  }
  if (isObject(source)) {
    if (typeof source.getReader === 'function') {
      return fromReadableStream(source as unknown as ReadableStream<Uint8Array>, signal);
    }
    if (typeof source.stream === 'function' && typeof source.arrayBuffer === 'function') {
      const blob = source as unknown as Blob;
      return {
        [Symbol.asyncIterator]: () =>
          fromReadableStream(blob.stream(), signal)[Symbol.asyncIterator](),
      };
    }
    const asyncIterable = source as Partial<AsyncIterable<Uint8Array>>;
    if (typeof asyncIterable[Symbol.asyncIterator] === 'function') {
      return fromIterator(
        () => (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator](),
        signal,
      );
    }
    const iterable = source as Partial<Iterable<Uint8Array>>;
    if (typeof iterable[Symbol.iterator] === 'function') {
      return fromIterator(() => (source as Iterable<Uint8Array>)[Symbol.iterator](), signal);
    }
  }
  throw dslError(
    'invalidArgument',
    'Unsupported input: expected a string, Uint8Array, ArrayBuffer, Blob, ReadableStream or ' +
      '(async) iterable of Uint8Array chunks.',
  );
}

async function* fromIterator(
  open: () => Iterator<unknown> | AsyncIterator<unknown>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  if (signal?.aborted) return;
  let iterator: Iterator<unknown> | AsyncIterator<unknown>;
  try {
    iterator = open();
  } catch (error) {
    throw readFailed(error);
  }
  let finished = false;
  const unlisten = onAbort(signal, () => {
    if (finished) return;
    finished = true;
    Promise.resolve(iterator.return?.()).catch(() => {});
  });
  try {
    for (let index = 0; !(signal?.aborted ?? false); index++) {
      let result: IteratorResult<unknown>;
      try {
        result = await iterator.next();
      } catch (error) {
        finished = true;
        throw readFailed(error);
      }
      if (result.done) {
        finished = true;
        return;
      }
      yield checkChunk(result.value, index);
    }
  } finally {
    unlisten();
    if (!finished) {
      finished = true;
      await iterator.return?.();
    }
  }
}

async function* fromReadableStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  if (signal?.aborted) {
    await stream.cancel(signal.reason).catch(() => {});
    return;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch (error) {
    throw readFailed(error);
  }
  let finished = false;
  // Cancelling the reader settles a pending read, which then ends the loop.
  const unlisten = onAbort(signal, () => {
    if (finished) return;
    finished = true;
    reader.cancel(signal?.reason).catch(() => {});
  });
  try {
    for (let index = 0; !(signal?.aborted ?? false); index++) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        finished = true;
        throw readFailed(error);
      }
      if (result.done) {
        finished = true;
        return;
      }
      yield checkChunk(result.value, index);
    }
  } finally {
    unlisten();
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Regroups chunks into chunks of exactly `size` bytes (the last one may be shorter). Large
 * chunks are sliced without copying; small ones are copied into a fresh buffer.
 */
export async function* rechunk(
  chunks: AsyncIterable<Uint8Array>,
  size: number,
): AsyncGenerator<Uint8Array> {
  let buffer: Uint8Array | undefined;
  let filled = 0;
  for await (let chunk of chunks) {
    if (buffer !== undefined) {
      const take = Math.min(size - filled, chunk.length);
      buffer.set(chunk.subarray(0, take), filled);
      filled += take;
      chunk = chunk.subarray(take);
      if (filled < size) continue;
      yield buffer;
      buffer = undefined;
    }
    while (chunk.length >= size) {
      yield chunk.subarray(0, size);
      chunk = chunk.subarray(size);
    }
    if (chunk.length > 0) {
      buffer = new Uint8Array(size);
      buffer.set(chunk);
      filled = chunk.length;
    }
  }
  if (buffer !== undefined) yield buffer.subarray(0, filled);
}
