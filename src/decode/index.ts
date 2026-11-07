/**
 * Decoding layer: input normalization, decompression, encoding detection and newline
 * normalization.
 *
 * @packageDocumentation
 */

export type { EncodingDecision, EncodingSource } from './byte-decoder.js';
export {
  type DecodeDslOptions,
  type DecodedText,
  type DecodeInfo,
  decodeDsl,
} from './decode.js';
export type { DecompressMode } from './gzip.js';
export type { DslSource } from './source.js';
