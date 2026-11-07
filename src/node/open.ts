/**
 * `openDsl`: opens a dictionary file together with the companion files next to it.
 *
 * @packageDocumentation
 */

import { openAsBlob } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createDiagnostic } from '../diagnostics/index.js';
import {
  type Annotation,
  type BodyLine,
  createDictionaryContext,
  type Diagnostic,
  type DiagnosticName,
  type DiagnosticSink,
  type DslEntry,
  DslError,
  type ParseDslOptions,
  type ParsedDsl,
  type PluginUse,
  parseAbbreviations,
  parseAnnotation,
  parseDsl,
} from '../index.js';
import { type CompanionKind, dictionaryBaseName, findCompanion } from './names.js';

/**
 * Which companion files `openDsl` looks for and loads. `true` (the default) is all, `false`
 * is none; with an object, the kinds that are left out are on.
 *
 * @experimental
 */
export type CompanionSelection =
  | boolean
  | {
      /** The abbreviations file, loaded into `abbreviations`. */
      readonly abbreviations?: boolean;
      /** The annotation file, loaded into `annotation`. */
      readonly annotation?: boolean;
      /** The icon, only reported in `files`. */
      readonly icon?: boolean;
      /** The media archive, only reported in `files`. */
      readonly media?: boolean;
    };

/**
 * Explicit paths of companion files, used instead of looking next to the dictionary. A path
 * is resolved against the current directory; a file that does not exist is reported
 * (`DSL6102`) and left out.
 *
 * @experimental
 */
export interface CompanionPaths {
  readonly abbreviations?: string;
  readonly annotation?: string;
  readonly icon?: string;
  readonly media?: string;
}

/**
 * Options of {@link openDsl}: those of `parseDsl`, plus the choice of companion files.
 *
 * `abbreviations` and `annotation` of `parseDsl` are also accepted: a value given here is
 * used as is, and the file of that kind is neither looked for nor read. `encoding`,
 * `decompress` and `strict` apply to the dictionary only: companion files are decoded with
 * automatic detection (and `defaultEncoding`), and their problems are always diagnostics,
 * never errors.
 *
 * @experimental
 */
export interface OpenDslOptions extends ParseDslOptions {
  /** Which companion files to look for and load. Default `true`. */
  readonly companions?: CompanionSelection;
  /** Explicit paths of companion files; see {@link CompanionPaths}. */
  readonly paths?: CompanionPaths;
}

/**
 * The files of an opened dictionary, as absolute paths.
 *
 * @experimental
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
 * An opened dictionary: what `parseDsl` returns, plus the companion files.
 *
 * @experimental
 */
export interface OpenedDsl<TEntry = DslEntry> extends ParsedDsl<TEntry> {
  /** The files that were found, or named in the options. */
  readonly files: DslFiles;
  /** The abbreviations, from `files.abbreviations` or the options; absent if there are none. */
  readonly abbreviations?: ReadonlyMap<string, string>;
  /** The annotation, from `files.annotation` or the options; absent if there is none. */
  readonly annotation?: Annotation;
}

const KINDS: readonly CompanionKind[] = ['abbreviations', 'annotation', 'icon', 'media'];

/**
 * Opens a DSL dictionary file and its companion files.
 *
 * The file is a `.dsl` or a `.dsl.dz` (also `.dsl.gz`; compression is detected by content, not
 * by name), read as a stream when the entries are requested. The companion files are looked
 * for in the same directory, by the base name of the dictionary (see `dictionaryBaseName`:
 * `foo.dsl` and `foo.dsl.dz` give `foo`), in any letter case:
 *
 * - `<base>_abrv.dsl`, `<base>_abrv.dsl.dz` (also `_ABRV.DSL`, `_ABRV.DSL.DZ`): abbreviations,
 *   read with `parseAbbreviations`. The uncompressed file wins.
 * - `<base>.ann`: annotation, read with `parseAnnotation`.
 * - `<base>.bmp`: icon; `<base>.dsl.files.zip`: media. These two are only reported.
 *
 * Of two files that differ only in case, the one spelled in lower case wins, then the one in
 * upper case. A missing companion is normal and not reported. One that cannot be read or
 * decoded is reported as a diagnostic (`DSL6101`) and left out; so is a companion named in the
 * `paths` option that does not exist (`DSL6102`). The diagnostics of reading the companions
 * come first in `diagnostics` and go to the `diagnostics` sink.
 *
 * Besides what `parseDsl` returns, the result has the `files` found and the loaded
 * `abbreviations` and `annotation`, which plugins receive in their context.
 *
 * @example
 * ```ts
 * const dict = await openDsl('en-ru.dsl.dz');
 * dict.files.annotation; // '/dicts/en-ru.ann', or undefined
 * for await (const { headwords, text } of dict.entries({ plugin: plainText })) { … }
 * ```
 *
 * @throws DslError `DSL0001` for invalid arguments, `DSL1001` if the dictionary file cannot
 * be opened.
 * @experimental
 */
export async function openDsl(
  path: string,
  options: OpenDslOptions & { readonly body: 'raw' },
): Promise<OpenedDsl<DslEntry<readonly BodyLine[]>>>;
export async function openDsl(
  path: string,
  options?: OpenDslOptions & { readonly body?: 'ast' },
): Promise<OpenedDsl<DslEntry>>;
export async function openDsl(
  path: string,
  options?: OpenDslOptions,
): Promise<OpenedDsl<DslEntry | DslEntry<readonly BodyLine[]>>>;
export async function openDsl(
  path: string,
  options: OpenDslOptions = {},
): Promise<OpenedDsl<DslEntry | DslEntry<readonly BodyLine[]>>> {
  if (typeof path !== 'string' || path.length === 0) {
    throw DslError.of('invalidArgument', 'The path must be a non-empty string.');
  }
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
  const { companions = true, paths = {}, ...parseOptions } = options;
  const wanted = selectCompanions(companions);
  if (typeof paths !== 'object' || paths === null) {
    throw DslError.of('invalidArgument', 'The paths option must be an object.');
  }
  for (const kind of KINDS) {
    if (paths[kind] !== undefined && typeof paths[kind] !== 'string') {
      throw DslError.of('invalidArgument', `The path of the ${kind} must be a string.`);
    }
  }
  const dictionary = resolve(path);
  const blob = await openDictionary(dictionary);

  const diagnostics: Diagnostic[] = [];
  const outer = options.diagnostics;
  const sink: DiagnosticSink = {
    report(diagnostic) {
      diagnostics.push(diagnostic);
      outer?.report(diagnostic);
    },
  };
  const report = (name: DiagnosticName, message: string, cause?: unknown): void =>
    sink.report(createDiagnostic(name, message, cause === undefined ? {} : { cause }));

  // What the caller provided is used as is; the files of those kinds are not even looked for.
  const given = {
    abbreviations: options.abbreviations !== undefined,
    annotation: options.annotation !== undefined,
  };
  const found = await locate(dictionary, paths, wanted, given, report);
  const companionOptions = {
    ...(options.defaultEncoding === undefined ? {} : { defaultEncoding: options.defaultEncoding }),
    diagnostics: sink,
  };
  const [abbreviations, annotation] = await Promise.all([
    found.abbreviations === undefined
      ? options.abbreviations
      : load(found.abbreviations, parseAbbreviations, companionOptions, report),
    found.annotation === undefined
      ? options.annotation
      : load(found.annotation, parseAnnotation, companionOptions, report),
  ] as const);

  const parsed = parseDsl(blob, {
    ...parseOptions,
    ...(abbreviations === undefined ? {} : { abbreviations }),
    ...(annotation === undefined ? {} : { annotation }),
  });
  const opened: OpenedDsl<DslEntry | DslEntry<readonly BodyLine[]>> = {
    get header() {
      return parsed.header;
    },
    get info() {
      return parsed.info;
    },
    get diagnostics() {
      return [...diagnostics, ...parsed.diagnostics];
    },
    entries: ((use?: PluginUse<unknown, unknown>) =>
      use === undefined
        ? parsed.entries()
        : (parsed as ParsedDsl).entries(use)) as OpenedDsl['entries'],
    batches: ((use?: PluginUse<unknown, unknown>) =>
      use === undefined
        ? parsed.batches()
        : (parsed as ParsedDsl).batches(use)) as OpenedDsl['batches'],
    files: Object.freeze({ dictionary, ...found }),
    ...(abbreviations === undefined ? {} : { abbreviations }),
    ...(annotation === undefined
      ? {}
      : { annotation: createDictionaryContext({ annotation }).annotation as Annotation }),
  };
  return opened;
}

function selectCompanions(companions: unknown): Record<CompanionKind, boolean> {
  if (typeof companions === 'boolean') {
    return {
      abbreviations: companions,
      annotation: companions,
      icon: companions,
      media: companions,
    };
  }
  if (typeof companions !== 'object' || companions === null) {
    throw DslError.of('invalidArgument', 'The companions option must be a boolean or an object.');
  }
  const selection = companions as Partial<Record<CompanionKind, unknown>>;
  const result = { abbreviations: true, annotation: true, icon: true, media: true };
  for (const kind of KINDS) {
    const value = selection[kind];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw DslError.of('invalidArgument', `The companions.${kind} option must be a boolean.`);
    }
    result[kind] = value;
  }
  return result;
}

/** Checks that the dictionary is a file and returns it as a lazily read blob. */
async function openDictionary(file: string): Promise<Blob> {
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    return await openAsBlob(file);
  } catch (error) {
    throw DslError.of('readFailed', `Cannot open the dictionary file ${file}.`, error);
  }
}

type Located = { -readonly [K in CompanionKind]?: string };

/** Finds the companion files: those named in `paths`, the others next to the dictionary. */
async function locate(
  dictionary: string,
  paths: CompanionPaths,
  wanted: Record<CompanionKind, boolean>,
  given: { readonly abbreviations: boolean; readonly annotation: boolean },
  report: (name: DiagnosticName, message: string, cause?: unknown) => void,
): Promise<Located> {
  const found: Located = {};
  const search: CompanionKind[] = [];
  for (const kind of KINDS) {
    const provided =
      kind === 'abbreviations' ? given.abbreviations : kind === 'annotation' && given.annotation;
    if (!wanted[kind] || provided) continue;
    const explicit = paths[kind];
    if (explicit === undefined) {
      search.push(kind);
    } else if (await isFile(explicit)) {
      found[kind] = resolve(explicit);
    } else {
      report('companionMissing', `The ${kind} file ${resolve(explicit)} does not exist.`);
    }
  }
  if (search.length === 0) return found;
  const directory = dirname(dictionary);
  let names: string[];
  try {
    names = await listFiles(directory);
  } catch (error) {
    report('companionUnreadable', `Cannot list ${directory} to look for companion files.`, error);
    return found;
  }
  const base = dictionaryBaseName(dictionary);
  for (const kind of search) {
    const name = findCompanion(names, base, kind);
    if (name !== undefined) found[kind] = join(directory, name);
  }
  return found;
}

/** The names of the files in a directory (symbolic links included, directories not). */
async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Loads a companion file; a failure is reported and gives `undefined`. */
async function load<TResult, TOptions>(
  file: string,
  parse: (source: Blob, options: TOptions) => Promise<TResult>,
  options: TOptions,
  report: (name: DiagnosticName, message: string, cause?: unknown) => void,
): Promise<TResult | undefined> {
  try {
    return await parse(await openAsBlob(file), options);
  } catch (error) {
    report('companionUnreadable', `Cannot read the companion file ${file}.`, error);
    return undefined;
  }
}
