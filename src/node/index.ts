/**
 * Node.js-specific entry point: opens dictionary files together with their companion files
 * (abbreviations, annotation, icon, media archive).
 *
 * @packageDocumentation
 */

export { type FindDictionariesOptions, findDictionaries } from './find.js';
export { dictionaryBaseName } from './names.js';
export {
  type CompanionPaths,
  type CompanionSelection,
  type OpenDslOptions,
  type OpenedDsl,
  openDsl,
} from './open.js';
