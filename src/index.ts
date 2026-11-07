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
export { type ColorName, isKnownColor } from './data/colors.js';
export {
  findLanguageById,
  findLanguageByName,
  type LanguageInfo,
  type LanguageMatch,
  type LanguageSupport,
  resolveLanguageName,
} from './data/languages.js';
export {
  getTagSpec,
  type TagAttrs,
  type TagDialect,
  type TagKind,
  type TagSpec,
} from './data/tags.js';
export {
  type DecodeDslOptions,
  type DecodedText,
  type DecodeInfo,
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
  type DiagnosticCounts,
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
  type ParseHeadwordOptions,
  type ParseHeadwordsOptions,
  parseHeadword,
  parseHeadwords,
} from './headword/index.js';
export {
  AST_VERSION,
  type BodyInput,
  isParentNode,
  type LineBreakNode,
  type LinkNode,
  type MarkupNode,
  type NodeLocation,
  type ParentNode,
  type ParseBodyOptions,
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
  walkEntry,
} from './markup/index.js';
export {
  type BodyMode,
  type DslEntry,
  type ParseDslOptions,
  type ParsedDsl,
  parseDsl,
  type RawParseDslOptions,
} from './parse/index.js';
export {
  createDictionaryContext,
  createPluginDiagnostic,
  type DictionaryContext,
  type DictionaryContextInit,
  type DslFiles,
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
  SEARCH_ZONES,
  type ToPlainTextOptions,
  toPlainText,
  type ZoneTextOptions,
  zoneText,
} from './render/index.js';
export {
  type BodyLine,
  type BodyLineKind,
  type Directive,
  type DslHeader,
  type LineSegment,
  positionInLine,
  type RawEntry,
  type RawLine,
  type SegmentDslOptions,
  type SegmentedDsl,
  type SubentryEndLine,
  type SubentryStartLine,
  segmentDsl,
  type TextBodyLine,
} from './segment/index.js';
export {
  createJsonlHeader,
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
