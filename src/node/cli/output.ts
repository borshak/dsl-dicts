/**
 * Writing text to a stream with backpressure, and detecting a closed pipe.
 *
 * @packageDocumentation
 */

import type { Writable } from 'node:stream';

/** Chunks are collected up to about this many characters before a write. */
const BATCH = 64 * 1024;

/** Resolves when the stream can take more, rejects if it fails or closes first. */
function drained(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error): void => {
      stream.off('drain', onDrain);
      stream.off('error', done);
      stream.off('close', onClose);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onDrain = (): void => done();
    const onClose = (): void => done(new Error('The output stream was closed.'));
    stream.on('drain', onDrain);
    stream.on('error', done);
    stream.on('close', onClose);
  });
}

/**
 * Writes the chunks to a stream as they come, waiting for `drain` when the stream is full, so
 * that a slow reader slows the producer down and memory stays flat. Small chunks are
 * gathered into larger writes. The stream is left open, but every chunk has been handed over
 * to it when the promise resolves.
 *
 * @throws The error of the stream, such as `EPIPE` when the reader has gone. The chunks
 * iterator is closed first.
 */
export async function writeChunks(
  stream: Writable,
  chunks: AsyncIterable<string> | Iterable<string>,
): Promise<void> {
  let failure: Error | undefined;
  const onError = (error: Error): void => {
    failure ??= error;
  };
  stream.on('error', onError);
  try {
    let batch: string[] = [];
    let size = 0;
    const flush = async (): Promise<void> => {
      if (failure !== undefined) throw failure;
      if (batch.length === 0) return;
      const text = batch.join('');
      batch = [];
      size = 0;
      if (!stream.write(text) && failure === undefined) await drained(stream);
      if (failure !== undefined) throw failure;
    };
    try {
      for await (const chunk of chunks) {
        batch.push(chunk);
        size += chunk.length;
        if (size >= BATCH) await flush();
      }
    } catch (error) {
      // What was produced before the failure is written, so that the output ends where it failed.
      await flush().catch(() => {});
      throw error;
    }
    await flush();
    // An empty write with a callback completes after the writes before it.
    await new Promise<void>((resolve, reject) => {
      stream.write('', (error) => (error ? reject(error) : resolve()));
    });
    if (failure !== undefined) throw failure;
  } finally {
    stream.off('error', onError);
  }
}

/** Ends a stream and waits until it has flushed everything; rejects on its error. */
export function endStream(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });
}
