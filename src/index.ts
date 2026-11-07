/**
 * Core entry point of dsl-dicts.
 *
 * Everything reachable from here is runtime-neutral: no Node.js APIs.
 *
 * @packageDocumentation
 */

export {
  type Annotation,
  type AnnotationSection,
  type ParseAbbreviationsOptions,
  type ParseAnnotationOptions,
  parseAbbreviations,
  parseAnnotation,
} from './companion/index.js';
export {
  findLanguageById,
  findLanguageByName,
  type LanguageInfo,
  type LanguageMatch,
  type LanguageSupport,
  resolveLanguageName,
} from './data/languages.js';
export {
  type DecodedText,
  type DecodeInfo,
  type DecodeOptions,
  type DecompressMode,
  type DslSource,
  decodeDsl,
  type EncodingDecision,
  type EncodingSource,
} from './decode/index.js';
export {
  type CollectingSink,
  createCollectingSink,
  createStrictSink,
  DIAGNOSTICS,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticName,
  type DiagnosticSink,
  type DiagnosticSpec,
  DslError,
  type DslErrorOptions,
  findDiagnosticSpec,
  type Severity,
  type SourcePosition,
} from './diagnostics/index.js';
export {
  type Headword,
  type HeadwordOptions,
  MAX_EXPANDED_LENGTH,
  MAX_VARIANTS,
  type ParseHeadwordOptions,
  parseHeadword,
  parseHeadwords,
} from './headword/index.js';
export {
  AST_VERSION,
  type BodyInput,
  type DeepReadonly,
  isParentNode,
  type LineBreakNode,
  type LinkNode,
  type MarkupNode,
  type MarkupOptions,
  type NodeLocation,
  type ParentNode,
  type ParseMarkupOptions,
  parseBody,
  parseMarkup,
  type SubentryNode,
  type TagAttributes,
  type TagNode,
  type TextNode,
  type TildeNode,
  type Visitor,
  type WalkResult,
  walk,
} from './markup/index.js';
export {
  type BodyMode,
  type DslEntry,
  type ParseDslOptions,
  type ParsedDsl,
  parseDsl,
} from './parse/index.js';
export {
  createDictionaryContext,
  createPluginDiagnostic,
  type DictionaryContext,
  type DictionaryContextInit,
  type DslPlugin,
  definePlugin,
  type EntryTransform,
  type PluginDiagnosticDetails,
  type PluginEntry,
  type PluginUse,
  setupPlugin,
} from './plugin/index.js';
export {
  hasZones,
  normalizeLabel,
  type PlainTextOptions,
  SEARCH_ZONES,
  toPlainText,
  zoneText,
} from './render/index.js';
export {
  type BodyLine,
  type BodyLineKind,
  createSegmenter,
  type Directive,
  type DslHeader,
  type LineSegment,
  positionInLine,
  type RawEntry,
  type RawLine,
  type SegmentedDsl,
  type Segmenter,
  type SegmenterOptions,
  type SegmentOptions,
  type SubentryEndLine,
  type SubentryStartLine,
  segmentDsl,
  type TextBodyLine,
} from './segment/index.js';
export {
  createDiagnosticTally,
  createJsonlHeader,
  type DiagnosticTally,
  JSONL_FORMAT,
  JSONL_FORMAT_VERSION,
  type JsonlComponent,
  type JsonlEntryRecord,
  type JsonlExpectations,
  type JsonlHeaderInit,
  type JsonlHeaderRecord,
  type JsonlReader,
  type JsonlRecord,
  type JsonlSummaryRecord,
  parseJsonlHeader,
  readJsonl,
  type ToJsonlOptions,
  type ToJsonOptions,
  toJson,
  toJsonl,
} from './serialize/index.js';
export { VERSION } from './version.js';
