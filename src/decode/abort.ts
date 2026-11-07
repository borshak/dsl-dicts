/**
 * The `signal` option: cancelling reading with an `AbortSignal`.
 *
 * @packageDocumentation
 */

import { type DslError, dslError } from '../diagnostics/index.js';

/**
 * Checks the `signal` option.
 *
 * @throws DslError `DSL0001` if it is not an `AbortSignal`.
 */
export function checkSignal(signal: unknown): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  const candidate = signal as Partial<AbortSignal> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.aborted !== 'boolean' ||
    typeof candidate.addEventListener !== 'function' ||
    typeof candidate.removeEventListener !== 'function'
  ) {
    throw dslError('invalidArgument', 'The signal option must be an AbortSignal.');
  }
  return signal as AbortSignal;
}

/** The error that ends reading when the signal aborts: `DSL0003`, the reason as the cause. */
export function abortError(signal: AbortSignal): DslError {
  return dslError('cancelled', 'Reading was aborted.', signal.reason);
}

/**
 * Calls `listener` once when the signal aborts (at once if it already has).
 *
 * @returns A function that removes the listener; call it when reading is over, so that a
 * long-lived signal does not keep the reader alive.
 */
export function onAbort(signal: AbortSignal | undefined, listener: () => void): () => void {
  if (signal === undefined) return () => {};
  if (signal.aborted) {
    queueMicrotask(listener);
    return () => {};
  }
  signal.addEventListener('abort', listener, { once: true });
  return () => signal.removeEventListener('abort', listener);
}
