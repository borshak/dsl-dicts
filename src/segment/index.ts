/**
 * Segmentation layer: header directives, `{{ }}` comments, entries and sub-entry markers.
 *
 * @packageDocumentation
 */

export { type SegmentedDsl, type SegmentOptions, segmentDsl } from './segment.js';
export { createSegmenter, type Segmenter, type SegmenterOptions } from './segmenter.js';
export {
  type BodyLine,
  type BodyLineKind,
  type Directive,
  type DslHeader,
  type LineSegment,
  positionInLine,
  type RawEntry,
  type RawLine,
  type SubentryEndLine,
  type SubentryStartLine,
  type TextBodyLine,
} from './types.js';
