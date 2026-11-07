/**
 * Companion files of a dictionary: abbreviations (`_abrv.dsl`) and annotation (`.ann`).
 *
 * @packageDocumentation
 */

export { type ParseAbbreviationsOptions, parseAbbreviations } from './abbreviations.js';
export {
  type Annotation,
  type AnnotationSection,
  type ParseAnnotationOptions,
  parseAnnotation,
} from './annotation.js';
