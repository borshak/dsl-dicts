/**
 * Serialization: JSONL and JSON export of parsed dictionaries, and a reader that checks
 * versions. Runtime-neutral: it produces and consumes text, and leaves files to the caller.
 *
 * @packageDocumentation
 */

export {
  createJsonlHeader,
  JSONL_FORMAT,
  JSONL_FORMAT_VERSION,
  type JsonlComponent,
  type JsonlEntryRecord,
  type JsonlHeaderInit,
  type JsonlHeaderRecord,
  type JsonlSummaryRecord,
} from './format.js';
export {
  type JsonlExpectations,
  type JsonlReader,
  type JsonlRecord,
  parseJsonlHeader,
  readJsonl,
} from './read.js';
export { createDiagnosticTally, type DiagnosticTally } from './tally.js';
export { type ToJsonlOptions, type ToJsonOptions, toJson, toJsonl } from './write.js';
