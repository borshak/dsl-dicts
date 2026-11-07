/**
 * Built-in plugins: projections of parsed entries into plain and search text.
 *
 * They are written against the public API of `dsl-dicts` only, like any third-party plugin.
 *
 * @packageDocumentation
 */

export { type PlainTextPluginOptions, type PlainTextResult, plainText } from './plain-text.js';
export { type SearchTextPluginOptions, type SearchTextResult, searchText } from './search-text.js';
