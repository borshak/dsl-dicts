/**
 * Node.js-specific entry point (file system and stream helpers).
 *
 * @packageDocumentation
 */

import { VERSION } from '../index.js';

/** Name of the runtime this entry point targets. */
export const RUNTIME = 'node';

/** Returns the package version together with the runtime name, e.g. `2.0.0 (node)`. */
export function describeRuntime(): string {
  return `${VERSION} (${RUNTIME})`;
}
