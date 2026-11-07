/**
 * Headword layer: optional and unsortable parts, escapes and index forms.
 *
 * @packageDocumentation
 */

export type { Headword } from '../markup/ast.js';
export {
  type HeadwordOptions,
  MAX_EXPANDED_LENGTH,
  MAX_VARIANTS,
  type ParseHeadwordOptions,
  parseHeadword,
  parseHeadwords,
} from './parse.js';
