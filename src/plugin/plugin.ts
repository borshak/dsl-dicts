/**
 * The plugin contract: what a consumer of the AST implements, and the context it receives.
 *
 * A plugin turns parsed entries into something else: plain text, search text, an article,
 * HTML. There is no registry and no hidden state: a plugin is passed explicitly to
 * `ParsedDsl.entries()` or `batches()`, or set up by hand with {@link setupPlugin}.
 *
 * @packageDocumentation
 */

import type { Annotation } from '../companion/annotation.js';
import type { DecodeInfo } from '../decode/decode.js';
import {
  CATALOG,
  createDiagnostic,
  type Diagnostic,
  type DiagnosticName,
  type DiagnosticSink,
  DslError,
  dslError,
  type Severity,
  type SourcePosition,
} from '../diagnostics/index.js';
import { AST_VERSION } from '../markup/ast.js';
import type { DslEntry } from '../parse/parse.js';
import type { DslHeader } from '../segment/index.js';
import { VERSION } from '../version.js';

/**
 * The files of a dictionary, as paths: those `openDsl` (`dsl-dicts/node`) found or was given.
 * Plain strings, so that the core can carry them without reading anything.
 */
export interface DslFiles {
  /** The dictionary file. */
  readonly dictionary: string;
  /** The abbreviations file (`<base>_abrv.dsl`, ...), if found. */
  readonly abbreviations?: string;
  /** The annotation file (`<base>.ann`), if found. */
  readonly annotation?: string;
  /** The icon (`<base>.bmp`), if found. */
  readonly icon?: string;
  /** The media archive (`<base>.dsl.files.zip`), if found; not read. */
  readonly media?: string;
}

/**
 * What a plugin knows about the dictionary, prepared before `setup` and read-only.
 *
 * Plain data plus a diagnostics sink. The optional slots are filled by whoever reads the
 * dictionary's companion files (the Node adapter, or the caller via `parseDsl` options or
 * {@link createDictionaryContext}); the core never reads files.
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
   * `parseDsl`, the diagnostics of the dictionary: they are counted and kept with the others
   * and go to the `diagnostics` sink of its options (strict mode applies: a diagnostic of the
   * strict severity throws). Set up by hand without a sink, reports are dropped.
   */
  readonly diagnostics: DiagnosticSink;
  /**
   * Abbreviations for `[p]` labels, from the dictionary's `_abrv.dsl`: label -> its
   * expansion. Keys are normalized with `normalizeLabel`, as `parseAbbreviations` makes them,
   * and `toPlainText` looks labels up the same way. Absent if there is no such file or nobody
   * read it.
   */
  readonly abbreviations?: ReadonlyMap<string, string>;
  /**
   * The dictionary's annotation, from its `.ann` file: an object with its language sections
   * and the text of the first one (see `Annotation`), not a bare string, so that plugins can
   * choose a language without parsing the file again. Absent if not read.
   */
  readonly annotation?: Annotation;
  /**
   * How the dictionary was decoded, when it is already known as the plugin is set up: the
   * plugin is set up as soon as the header is complete, and nothing more is read for it. For
   * most files the encoding is known by then; for a file of ASCII text it is only known at
   * the end, and this is absent.
   */
  readonly info?: DecodeInfo;
  /** The files of the dictionary, when it was opened from files (`openDsl`). */
  readonly files?: DslFiles;
}

/**
 * The entry a plugin receives: a parsed entry, read-only like every AST type. Plugins must
 * not mutate it; the tests of the built-in plugins run them on frozen entries.
 */
export type PluginEntry = DslEntry;

/**
 * What `setup` returns: a synchronous function called once per entry, which returns exactly
 * one output for it. Serialization (`toJsonl`) refuses an output that is not JSON, such as
 * `undefined` (`DSL7006`).
 */
export type EntryTransform<TOut> = (entry: PluginEntry) => TOut;

/**
 * A plugin: a named, versioned consumer of parsed entries.
 *
 * `setup` is called once per dictionary, synchronously, with a context that is complete
 * (header known, companion files read). It validates its options, prepares what it needs
 * (lookups, profiles) and returns the function that transforms each entry. That function is
 * called synchronously for every entry, so streaming is not affected, and returns exactly one
 * output per entry. Neither may mutate its input; both may throw. An error of the transform,
 * and one of `setup`, reaches the caller as a `DslError` that names the plugin (`plugin`):
 * `DSL5002` and `DSL5001` respectively, with the original error as the cause, except a
 * `DslError` `DSL0001` thrown by `setup` for invalid options, which stays a `DSL0001`.
 *
 * `setup` is synchronous by design. A plugin that needs asynchronous resources (a word list,
 * a model) is made by an asynchronous factory: it awaits them first, then returns the plugin.
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
 * @example An asynchronous factory:
 * ```ts
 * async function createStopWordPlugin(url: string) {
 *   const words = new Set((await (await fetch(url)).text()).split('\n'));
 *   return definePlugin({
 *     name: 'stop-words',
 *     version: '1.0.0',
 *     setup: () => (entry) => entry.headwords.filter((h) => !words.has(h.text)).length,
 *   });
 * }
 * ```
 *
 * @typeParam TOut - What the plugin makes of an entry. Keep it JSON-serializable, so that it
 * can be exported (JSONL).
 * @typeParam TOptions - The options of `setup`: `void` for none, `X | undefined` for optional
 * options. Either way `entries({ plugin })` and `setupPlugin(plugin, context)` may leave them
 * out; a direct `setup` call passes `undefined` for `X | undefined`.
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
  /**
   * Prepares the plugin for one dictionary and returns the per-entry transform. Throw a
   * `DslError` `DSL0001` for invalid options.
   */
  setup(context: DictionaryContext, options: TOptions): EntryTransform<TOut>;
}

/**
 * Selects a plugin for `ParsedDsl.entries()`, `batches()` and the exports (`toJsonl`).
 * `options` may be left out when the plugin's options accept `undefined` (`void` or
 * `X | undefined`); a plugin with required options without them is a type error.
 */
export type PluginUse<TOut, TOptions> = {
  /** The plugin. */
  readonly plugin: DslPlugin<TOut, TOptions>;
} & (undefined extends TOptions
  ? {
      /** The options of the plugin, passed to its `setup`. */
      readonly options?: TOptions;
    }
  : {
      /** The options of the plugin, passed to its `setup`. */
      readonly options: TOptions;
    });

/**
 * The arguments of {@link createDictionaryContext}: everything but the versions, which are
 * always those of this package.
 */
export interface DictionaryContextInit {
  /** The header; default: an empty header (no directives). */
  readonly header?: DslHeader;
  /** Where plugins report problems; default: a sink that drops them. */
  readonly diagnostics?: DiagnosticSink;
  /** Expansions of `[p]` labels, such as the result of `parseAbbreviations`. */
  readonly abbreviations?: ReadonlyMap<string, string>;
  /**
   * The annotation: the result of `parseAnnotation`, or a string, which becomes one section
   * without a language.
   */
  readonly annotation?: Annotation | string;
  /** How the dictionary was decoded (`ParsedDsl.info`). */
  readonly info?: DecodeInfo;
  /** The files of the dictionary. */
  readonly files?: DslFiles;
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
 */
export function createDictionaryContext(init: DictionaryContextInit = {}): DictionaryContext {
  if (typeof init !== 'object' || init === null) {
    throw dslError('invalidArgument', 'The context init must be an object.');
  }
  const {
    header = EMPTY_HEADER,
    diagnostics = DROP,
    abbreviations,
    annotation,
    info,
    files,
  } = init;
  if (typeof header !== 'object' || header === null || !Array.isArray(header.directives)) {
    throw dslError('invalidArgument', 'The header must be a DslHeader.');
  }
  if (typeof diagnostics !== 'object' || diagnostics === null) {
    throw dslError('invalidArgument', 'The diagnostics option must be a sink.');
  }
  if (typeof diagnostics.report !== 'function') {
    throw dslError('invalidArgument', 'The diagnostics sink must have a report method.');
  }
  if (
    abbreviations !== undefined &&
    (typeof abbreviations !== 'object' ||
      abbreviations === null ||
      typeof abbreviations.get !== 'function' ||
      typeof abbreviations.has !== 'function')
  ) {
    throw dslError('invalidArgument', 'The abbreviations must be a Map.');
  }
  if (info !== undefined && (typeof info !== 'object' || info === null)) {
    throw dslError('invalidArgument', 'The info must be a DecodeInfo.');
  }
  if (
    files !== undefined &&
    (typeof files !== 'object' || files === null || typeof files.dictionary !== 'string')
  ) {
    throw dslError('invalidArgument', 'The files must be a DslFiles object.');
  }
  const resolved = annotation === undefined ? undefined : toAnnotation(annotation);
  const context: { -readonly [K in keyof DictionaryContext]: DictionaryContext[K] } = {
    header,
    astVersion: AST_VERSION,
    packageVersion: VERSION,
    diagnostics,
  };
  if (abbreviations !== undefined) context.abbreviations = abbreviations;
  if (resolved !== undefined) context.annotation = resolved;
  if (info !== undefined) context.info = info;
  if (files !== undefined) context.files = files;
  return Object.freeze(context);
}

/** Checks an annotation; a string becomes a single section without a language. */
function toAnnotation(annotation: unknown): Annotation {
  if (typeof annotation === 'string') {
    return { sections: annotation.length === 0 ? [] : [{ text: annotation }], text: annotation };
  }
  const { sections, text } = (annotation ?? {}) as Partial<Annotation>;
  if (
    typeof annotation !== 'object' ||
    annotation === null ||
    typeof text !== 'string' ||
    !Array.isArray(sections) ||
    sections.some((section) => typeof section?.text !== 'string')
  ) {
    throw dslError('invalidArgument', 'The annotation must be a string or an Annotation.');
  }
  return annotation as Annotation;
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
    throw dslError('invalidArgument', 'The plugin must be an object.');
  }
  const { name, version, setup } = plugin as Partial<DslPlugin<unknown, unknown>>;
  if (typeof name !== 'string' || !/^\S+$/.test(name)) {
    throw dslError('invalidArgument', 'The plugin name must be a non-empty word.');
  }
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw dslError(
      'invalidArgument',
      `The version of plugin ${name} must be a semantic version, such as 1.0.0.`,
    );
  }
  if (typeof setup !== 'function') {
    throw dslError('invalidArgument', `Plugin ${name} must have a setup function.`);
  }
}

/**
 * Declares a plugin. An identity function that checks the plugin's shape and lets TypeScript
 * infer its output and options types from `setup`.
 *
 * @throws DslError `DSL0001` if the name, version or `setup` is invalid.
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
 * `DSL5002` with the plugin name and the entry position (the original error is the cause),
 * the error of strict mode for a diagnostic the plugin reported included.
 * @throws DslError `DSL0001` for an invalid plugin, and for invalid options (a `DslError`
 * `DSL0001` thrown by `setup`, rethrown with the plugin name); `DSL5001` if `setup` throws
 * anything else (the original error is the cause) or returns something other than a
 * function.
 */
export function setupPlugin<TOut, TOptions>(
  plugin: DslPlugin<TOut, TOptions>,
  context: DictionaryContext,
  ...[options]: undefined extends TOptions ? [options?: TOptions] : [options: TOptions]
): EntryTransform<TOut> {
  checkPlugin(plugin);
  if (typeof context !== 'object' || context === null) {
    throw dslError('invalidArgument', 'The context must be a DictionaryContext.');
  }
  const label = `${plugin.name}@${plugin.version}`;
  let transform: unknown;
  try {
    transform = plugin.setup(context, options as TOptions);
  } catch (error) {
    if (error instanceof DslError && error.code === CATALOG.invalidArgument.code) {
      throw new DslError(error.code, `Plugin ${label}: ${error.message}`, {
        cause: error.cause,
        plugin: plugin.name,
      });
    }
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
  return new DslError(CATALOG[name].code, `${message}${reason}`, { cause, plugin, position });
}

/** Details of {@link createPluginDiagnostic}. */
export interface PluginDiagnosticDetails {
  /**
   * The code of the problem: by convention the plugin name, a slash and an identifier of the
   * plugin's choice, such as `my-plugin/no-translation`, so that codes of different plugins
   * never collide with each other or with the catalog. Default `DSL5101`.
   */
  readonly code?: string;
  /** Default `warning`. */
  readonly severity?: Severity;
  /** Where the problem is, e.g. the entry's `position`. */
  readonly position?: SourcePosition;
}

const SEVERITIES: ReadonlySet<unknown> = new Set(['error', 'warning', 'info']);

/**
 * Creates a diagnostic for a plugin to report through `context.diagnostics`: the code of the
 * details (default `DSL5101`), the message prefixed with the plugin name, and `source` set to
 * the plugin name.
 *
 * @example
 * ```ts
 * context.diagnostics.report(
 *   createPluginDiagnostic(plugin, 'The entry has no translation.', {
 *     code: 'my-plugin/no-translation',
 *     position: entry.position,
 *   }),
 * );
 * ```
 *
 * @throws DslError `DSL0001` for a code that is not a non-empty string without whitespace, or
 * a severity that is not one.
 */
export function createPluginDiagnostic(
  plugin: Pick<DslPlugin<unknown, never>, 'name'> | string,
  message: string,
  details: PluginDiagnosticDetails = {},
): Diagnostic {
  const name = typeof plugin === 'string' ? plugin : plugin.name;
  const { code, severity, position } = details;
  if (code !== undefined && (typeof code !== 'string' || !/^\S+$/.test(code))) {
    throw dslError('invalidArgument', 'The code must be a non-empty string without spaces.');
  }
  if (severity !== undefined && !SEVERITIES.has(severity)) {
    throw dslError('invalidArgument', 'The severity must be "error", "warning" or "info".');
  }
  const base = createDiagnostic(
    'pluginDiagnostic',
    `${name}: ${message}`,
    position === undefined ? {} : { position },
  );
  return {
    ...base,
    ...(code === undefined ? {} : { code }),
    ...(severity === undefined ? {} : { severity }),
    source: name,
  };
}
