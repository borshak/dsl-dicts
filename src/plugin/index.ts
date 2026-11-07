/**
 * Plugin layer: the contract between the parser and the consumers of its entries.
 *
 * @packageDocumentation
 */

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
} from './plugin.js';
