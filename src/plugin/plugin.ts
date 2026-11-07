/**
 * The plugin contract: what a consumer of the AST implements, and the context it receives.
 *
 * A plugin turns parsed entries into something else: plain text, search text, an article,
 * HTML. There is no registry and no hidden state: a plugin is passed explicitly to
 * `ParsedDsl.entries()` or `batches()`, or set up by hand with {@link setupPlugin}.
 *
 * @packageDocumentation
 */

import {
  createDiagnostic,
  DIAGNOSTICS,
  type Diagnostic,
  type DiagnosticName,
  type DiagnosticSink,
  DslError,
  type Severity,
  type SourcePosition,
} from '../diagnostics/index.js';
import { AST_VERSION, type DeepReadonly } from '../markup/ast.js';
import type { DslEntry } from '../parse/parse.js';
import type { DslHeader } from '../segment/index.js';
import { VERSION } from '../version.js';

/**
 * What a plugin knows about the dictionary, prepared before `setup` and read-only.
 *
 * Plain data plus a diagnostics sink. The optional slots are filled by whoever reads the
 * dictionary's companion files (the Node adapter, or the caller via `parseDsl` options or
 * {@link createDictionaryContext}); the core never reads files.
 *
 * @experimental
 */
export interface DictionaryContext {
  /**
   * The header: directives, name, and the index and contents languages, resolved
   * (`indexLanguageInfo`, `contentsLanguageInfo`).
   */
  readonly header: DslHeader;
  /** Version of the AST schema the entries follow: `AST_VERSION`. */
  readonly astVersion: number;
  /** Version of dsl-dicts: `VERSION`. */
  readonly packageVersion: string;
  /**
   * Where the plugin reports problems, e.g. with {@link createPluginDiagnostic}. In
   * `parseDsl`, the `diagnostics` sink of its options (strict mode applies: a diagnostic of
   * severity `error` throws); without one, reports are dropped.
   */
  readonly diagnostics: DiagnosticSink;
  /**
   * Abbreviations for `[p]` labels, from the dictionary's `_abrv.dsl`: label as written ->
   * its expansion. Absent if there is no such file or nobody read it.
   */
  readonly abbreviations?: ReadonlyMap<string, string>;
  /** The dictionary's annotation, from its `.ann` file, as text. Absent if not read. */
  readonly annotation?: string;
}

/**
 * The entry a plugin receives: a parsed entry, deeply read-only. Plugins must not mutate it;
 * the tests of the built-in plugins run them on frozen entries.
 *
 * @experimental
 */
export type PluginEntry = DeepReadonly<DslEntry>;

/**
 * What `setup` returns: a synchronous function called once per entry.
 *
 * @experimental
 */
export type EntryTransform<TOut> = (entry: PluginEntry) => TOut;

/**
 * A plugin: a named, versioned consumer of parsed entries.
 *
 * `setup` is called once per dictionary, synchronously, with a context that is complete
 * (header known, companion files read). It validates its options, prepares what it needs
 * (lookups, profiles) and returns the function that transforms each entry. That function is
 * called synchronously for every entry, so streaming is not affected. Neither may mutate its
 * input; both may throw, and the error reaches the caller wrapped in a `DslError`
 * (`DSL5001` from `setup`, `DSL5002` from the transform) that names the plugin.
 *
 * @example
 * ```ts
 * const headwordList = definePlugin({
 *   name: 'headword-list',
 *   version: '1.0.0',
 *   setup: (context, options: { separator: string }) => (entry) =>
 *     entry.headwords.map((h) => h.text).join(options.separator),
 * });
 * ```
 *
 * @typeParam TOut - What the plugin makes of an entry. Keep it JSON-serializable, so that it
 * can be exported (JSONL).
 * @typeParam TOptions - The options of `setup`: `void` for none, `X | undefined` for optional
 * options. Either way `entries({ plugin })` and `setupPlugin(plugin, context)` may leave them
 * out; a direct `setup` call passes `undefined` for `X | undefined`.
 * @experimental
 */
export interface DslPlugin<TOut, TOptions = void> {
  /** Unique name, in kebab case by convention: `plain-text`. No whitespace. */
  readonly name: string;
  /**
   * Semantic version of the plugin's output format (not of its code): a change that can break
   * a consumer of the output is a new major version. Recorded with exports, as
   * `name@version`.
   */
  readonly version: string;
  /** Prepares the plugin for one dictionary and returns the per-entry transform. */
  setup(context: DictionaryContext, options: TOptions): EntryTransform<TOut>;
}

/**
 * Selects a plugin for `ParsedDsl.entries()` and `batches()`. `options` may be left out when
 * the plugin's options accept `undefined` (`void` or `X | undefined`).
 *
 * @experimental
 */
export type PluginUse<TOut, TOptions> = {
  readonly plugin: DslPlugin<TOut, TOptions>;
} & (undefined extends TOptions ? { readonly options?: TOptions } : { readonly options: TOptions });

/**
 * The arguments of {@link createDictionaryContext}: everything but the versions, which are
 * always those of this package.
 *
 * @experimental
 */
export interface DictionaryContextInit {
  /** The header; default: an empty header (no directives). */
  readonly header?: DslHeader;
  /** Where plugins report problems; default: a sink that drops them. */
  readonly diagnostics?: DiagnosticSink;
  readonly abbreviations?: ReadonlyMap<string, string>;
  readonly annotation?: string;
}

const EMPTY_HEADER: DslHeader = Object.freeze({ directives: Object.freeze([]) });
const DROP: DiagnosticSink = Object.freeze({ report() {} });

/**
 * Creates the context of a plugin, for setting plugins up by hand: with entries from
 * `parseDsl` in `raw` mode, from another source, or for tests. `parseDsl` builds it by
 * itself when a plugin is passed to `entries()` or `batches()`.
 *
 * @returns A frozen context.
 * @throws DslError `DSL0001` for arguments of the wrong type.
 * @experimental
 */
export function createDictionaryContext(init: DictionaryContextInit = {}): DictionaryContext {
  if (typeof init !== 'object' || init === null) {
    throw DslError.of('invalidArgument', 'The context init must be an object.');
  }
  const { header = EMPTY_HEADER, diagnostics = DROP, abbreviations, annotation } = init;
  if (typeof header !== 'object' || header === null || !Array.isArray(header.directives)) {
    throw DslError.of('invalidArgument', 'The header must be a DslHeader.');
  }
  if (typeof diagnostics !== 'object' || diagnostics === null) {
    throw DslError.of('invalidArgument', 'The diagnostics option must be a sink.');
  }
  if (typeof diagnostics.report !== 'function') {
    throw DslError.of('invalidArgument', 'The diagnostics sink must have a report method.');
  }
  if (
    abbreviations !== undefined &&
    (typeof abbreviations !== 'object' ||
      abbreviations === null ||
      typeof abbreviations.get !== 'function' ||
      typeof abbreviations.has !== 'function')
  ) {
    throw DslError.of('invalidArgument', 'The abbreviations must be a Map.');
  }
  if (annotation !== undefined && typeof annotation !== 'string') {
    throw DslError.of('invalidArgument', 'The annotation must be a string.');
  }
  const context: { -readonly [K in keyof DictionaryContext]: DictionaryContext[K] } = {
    header,
    astVersion: AST_VERSION,
    packageVersion: VERSION,
    diagnostics,
  };
  if (abbreviations !== undefined) context.abbreviations = abbreviations;
  if (annotation !== undefined) context.annotation = annotation;
  return Object.freeze(context);
}

/** Semantic Versioning 2.0.0. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Checks the shape of a plugin: a name without whitespace, a semantic version and a `setup`
 * function.
 *
 * @throws DslError `DSL0001` if it is not a valid plugin.
 */
function checkPlugin(plugin: unknown): asserts plugin is DslPlugin<unknown, unknown> {
  if (typeof plugin !== 'object' || plugin === null) {
    throw DslError.of('invalidArgument', 'The plugin must be an object.');
  }
  const { name, version, setup } = plugin as Partial<DslPlugin<unknown, unknown>>;
  if (typeof name !== 'string' || !/^\S+$/.test(name)) {
    throw DslError.of('invalidArgument', 'The plugin name must be a non-empty word.');
  }
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw DslError.of(
      'invalidArgument',
      `The version of plugin ${name} must be a semantic version, such as 1.0.0.`,
    );
  }
  if (typeof setup !== 'function') {
    throw DslError.of('invalidArgument', `Plugin ${name} must have a setup function.`);
  }
}

/**
 * Declares a plugin. An identity function that checks the plugin's shape and lets TypeScript
 * infer its output and options types from `setup`.
 *
 * @throws DslError `DSL0001` if the name, version or `setup` is invalid.
 * @experimental
 */
export function definePlugin<TOut, TOptions = void>(
  plugin: DslPlugin<TOut, TOptions>,
): DslPlugin<TOut, TOptions> {
  checkPlugin(plugin);
  return plugin;
}

/**
 * Sets a plugin up: calls `setup` once and returns its transform, with errors wrapped. This
 * is what `ParsedDsl.entries({ plugin })` does; use it to apply a plugin to entries by hand.
 * Calling `plugin.setup` directly works too, without the wrapping.
 *
 * @returns The per-entry transform. An error it throws is rethrown as a `DslError`
 * `DSL5002` with the plugin name and the entry position (the original error is the cause).
 * @throws DslError `DSL0001` for an invalid plugin; `DSL5001` if `setup` throws (the original
 * error is the cause) or returns something other than a function.
 * @experimental
 */
export function setupPlugin<TOut, TOptions>(
  plugin: DslPlugin<TOut, TOptions>,
  context: DictionaryContext,
  ...[options]: undefined extends TOptions ? [options?: TOptions] : [options: TOptions]
): EntryTransform<TOut> {
  checkPlugin(plugin);
  if (typeof context !== 'object' || context === null) {
    throw DslError.of('invalidArgument', 'The context must be a DictionaryContext.');
  }
  const label = `${plugin.name}@${plugin.version}`;
  let transform: unknown;
  try {
    transform = plugin.setup(context, options as TOptions);
  } catch (error) {
    throw failure('pluginSetupFailed', plugin.name, `Plugin ${label} failed to set up`, error);
  }
  if (typeof transform !== 'function') {
    throw failure(
      'pluginSetupFailed',
      plugin.name,
      `Plugin ${label} failed to set up: setup returned no function`,
    );
  }
  const run = transform as EntryTransform<TOut>;
  return (entry) => {
    try {
      return run(entry);
    } catch (error) {
      const position = entry?.position;
      const where = position === undefined ? '' : ` on the entry at line ${position.line}`;
      throw failure('pluginFailed', plugin.name, `Plugin ${label} failed${where}`, error, position);
    }
  };
}

function failure(
  name: DiagnosticName,
  plugin: string,
  message: string,
  cause?: unknown,
  position?: SourcePosition,
): DslError {
  const reason = cause === undefined ? '' : `: ${cause instanceof Error ? cause.message : cause}`;
  return new DslError(DIAGNOSTICS[name].code, `${message}${reason}`, { cause, plugin, position });
}

/**
 * Details of {@link createPluginDiagnostic}.
 *
 * @experimental
 */
export interface PluginDiagnosticDetails {
  /** Default `warning`. */
  readonly severity?: Severity;
  /** Where the problem is, e.g. the entry's `position`. */
  readonly position?: SourcePosition;
}

/**
 * Creates a diagnostic for a plugin to report through `context.diagnostics`: code `DSL5101`,
 * the message prefixed with the plugin name.
 *
 * @example
 * ```ts
 * context.diagnostics.report(
 *   createPluginDiagnostic(plugin, 'The entry has no translation.', { position: entry.position }),
 * );
 * ```
 *
 * @experimental
 */
export function createPluginDiagnostic(
  plugin: Pick<DslPlugin<unknown, never>, 'name'> | string,
  message: string,
  details: PluginDiagnosticDetails = {},
): Diagnostic {
  const name = typeof plugin === 'string' ? plugin : plugin.name;
  const position = details.position === undefined ? {} : { position: details.position };
  const diagnostic = createDiagnostic('pluginDiagnostic', `${name}: ${message}`, position);
  return details.severity === undefined
    ? diagnostic
    : { ...diagnostic, severity: details.severity };
}
