/**
 * The JSONL export format: constants, record types and the header record.
 *
 * A JSONL document is a sequence of JSON records, one per line, each with a `type`:
 *
 * ```
 * {"type":"header","format":"dsl-dicts/jsonl","formatVersion":1,...}
 * {"type":"entry","data":{...}}
 * {"type":"summary","entries":2,"diagnostics":{"DSL2001":1}}
 * ```
 *
 * Three versions evolve independently, each with the rule "incompatible change, major
 * increment; new optional fields, compatible":
 *
 * - `formatVersion`: the envelope (record types and the fields of the header and summary).
 *   An integer, which is a major version: compatible additions do not change it.
 * - `astVersion`: the schema of the AST (`AST_VERSION`), which is the entry payload of an
 *   export without a plugin and the input of every plugin.
 * - `plugin.version`: the semantic version of the plugin's output format.
 *
 * A reader checks `format` and the major versions and refuses what it does not know; see
 * `readJsonl`.
 *
 * @packageDocumentation
 */

import type { DecodeInfo } from '../decode/decode.js';
import { AST_VERSION } from '../markup/ast.js';
import type { DslHeader } from '../segment/index.js';
import { VERSION } from '../version.js';

/** Value of the `format` field of the header record. */
export const JSONL_FORMAT = 'dsl-dicts/jsonl';

/** Current `formatVersion` of the JSONL envelope (a major version). */
export const JSONL_FORMAT_VERSION = 1;

/**
 * A name and a version: of the generator, or of the plugin whose output the entries are.
 *
 * @experimental
 */
export interface JsonlComponent {
  readonly name: string;
  readonly version: string;
}

/**
 * The first record of a JSONL document, and the `header` of a JSON document: what is needed to
 * read the entries.
 *
 * @experimental
 */
export interface JsonlHeaderRecord {
  readonly type: 'header';
  /** Always {@link JSONL_FORMAT}. */
  readonly format: typeof JSONL_FORMAT;
  /** Major version of the envelope; see {@link JSONL_FORMAT_VERSION}. */
  readonly formatVersion: number;
  /** Who wrote the document. */
  readonly generator: JsonlComponent;
  /** `AST_VERSION` of the entries the document was made from. */
  readonly astVersion: number;
  /**
   * The plugin whose output the entries are, or `null` if the entries are AST entries
   * (`DslEntry`) as is.
   */
  readonly plugin: JsonlComponent | null;
  /** The directives of the dictionary header; `null` for a missing one. */
  readonly dictionary: {
    readonly name: string | null;
    readonly indexLanguage: string | null;
    readonly contentsLanguage: string | null;
  };
  /** How the file was decoded. */
  readonly decode: {
    /** Canonical WHATWG encoding name, e.g. `utf-16le`. */
    readonly encoding: string;
    /** How the encoding was chosen (`EncodingSource`), e.g. `bom`. */
    readonly source: string;
    readonly compression: 'gzip' | 'none';
  };
}

/**
 * One entry of a JSONL document. The payload is in `data`, not spread into the record, so that
 * it cannot collide with the envelope (`type`), may be any JSON value (a plugin may return a
 * string or an array), and the envelope can grow without breaking plugins.
 *
 * @typeParam T - The payload: `DslEntry` for an export without a plugin, else what the plugin
 * returns.
 * @experimental
 */
export interface JsonlEntryRecord<T = unknown> {
  readonly type: 'entry';
  readonly data: T;
}

/**
 * The optional last record: how many entries were written and how many diagnostics of each
 * code were reported, counts only. A document without it may be cut short.
 *
 * @experimental
 */
export interface JsonlSummaryRecord {
  readonly type: 'summary';
  /** The number of entry records. */
  readonly entries: number;
  /** Number of diagnostics by code, in code order. */
  readonly diagnostics: Readonly<Record<string, number>>;
}

/**
 * Arguments of {@link createJsonlHeader}.
 *
 * @experimental
 */
export interface JsonlHeaderInit {
  /** The header of the dictionary (`ParsedDsl.header`). */
  readonly header: DslHeader;
  /** The decoding information (`ParsedDsl.info`). */
  readonly info: DecodeInfo;
  /** The plugin that makes the entries; leave out for AST entries. */
  readonly plugin?: JsonlComponent;
}

/**
 * Creates the header record of an export.
 *
 * @example
 * ```ts
 * const dict = parseDsl(bytes);
 * createJsonlHeader({ header: await dict.header, info: await dict.info, plugin: article });
 * ```
 *
 * @experimental
 */
export function createJsonlHeader({ header, info, plugin }: JsonlHeaderInit): JsonlHeaderRecord {
  return {
    type: 'header',
    format: JSONL_FORMAT,
    formatVersion: JSONL_FORMAT_VERSION,
    generator: { name: 'dsl-dicts', version: VERSION },
    astVersion: AST_VERSION,
    plugin: plugin === undefined ? null : { name: plugin.name, version: plugin.version },
    dictionary: {
      name: header.name ?? null,
      indexLanguage: header.indexLanguage ?? null,
      contentsLanguage: header.contentsLanguage ?? null,
    },
    decode: { encoding: info.encoding, source: info.source, compression: info.compression },
  };
}
