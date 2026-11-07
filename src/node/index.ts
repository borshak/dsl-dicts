/**
 * Node.js-specific entry point: opens dictionary files together with their companion files
 * (abbreviations, annotation, icon, media archive).
 *
 * @packageDocumentation
 */

import { VERSION } from '../index.js';

export { type FindDictionariesOptions, findDictionaries } from './find.js';
export { dictionaryBaseName } from './names.js';
export {
  type CompanionPaths,
  type CompanionSelection,
  type DslFiles,
  type OpenDslOptions,
  type OpenedDsl,
  openDsl,
} from './open.js';

/** Name of the runtime this entry point targets. */
export const RUNTIME = 'node';

/** Returns the package version together with the runtime name, e.g. `2.0.0 (node)`. */
export function describeRuntime(): string {
  return `${VERSION} (${RUNTIME})`;
}
