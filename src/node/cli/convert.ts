/**
 * `dsl-dicts convert`.
 *
 * @packageDocumentation
 */

import { createWriteStream, statSync } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';
import {
  type DiagnosticCounts,
  type DslEntry,
  type ParsedDsl,
  type PluginUse,
  toJson,
  toJsonl,
} from '../../index.js';
import { findDictionaries } from '../find.js';
import { dictionaryBaseName } from '../names.js';
import { type OpenDslOptions, openDsl } from '../open.js';
import {
  CliError,
  describeError,
  displayPath,
  EXIT,
  exitCodeOf,
  isBrokenPipe,
  usageError,
} from './errors.js';
import type { CliIo } from './io.js';
import type { ConvertOptions, InfoOptions } from './options.js';
import { endStream, writeChunks } from './output.js';
import { type AnyPlugin, parsePluginOptions, resolvePlugin } from './plugins.js';
import { createReporter } from './report.js';

/** Runs `convert`; returns the exit code. */
export async function convert(options: ConvertOptions, io: CliIo): Promise<number> {
  const input = resolve(io.cwd, options.path);
  const stats = await stat(input).catch((error: unknown) => {
    throw new CliError(EXIT.dictionary, `Cannot read ${input}: ${describeError(error)}`, {
      cause: error,
    });
  });

  // The plugin is loaded before any output is made, and once for all dictionaries.
  const plugin =
    options.plugin === undefined ? undefined : await resolvePlugin(options.plugin, io.cwd);
  const pluginOptions =
    options.pluginOptions === undefined ? undefined : parsePluginOptions(options.pluginOptions);
  const label = plugin?.name ?? 'ast';

  if (!stats.isDirectory()) {
    return convertOne(
      input,
      singleTarget(options, io, input, label),
      options,
      plugin,
      pluginOptions,
      io,
    );
  }
  if (options.output === undefined) {
    throw usageError('convert: a directory needs -o <output directory>.');
  }
  const files = await findDictionaries(input, { recursive: options.recursive });
  if (files.length === 0) {
    throw new CliError(EXIT.dictionary, `No dictionaries found in ${input}.`);
  }
  const outputDir = resolve(io.cwd, options.output);
  const extension = options.format;
  let code: number = EXIT.ok;
  let converted = 0;
  for (const file of files) {
    const relativeDir = relative(input, dirname(file));
    const target = join(
      outputDir,
      relativeDir,
      `${dictionaryBaseName(file)}.${label}.${extension}`,
    );
    const result = await convertOne(file, { path: target }, options, plugin, pluginOptions, io);
    if (result === EXIT.ok) converted++;
    // An internal error outranks a plugin failure, which outranks the failures of dictionaries.
    else if (rank(result) > rank(code)) code = result;
  }
  if (options.verbosity !== 'quiet') {
    io.stderr.write(
      `Converted ${converted} of ${files.length} dictionaries to ${displayPath(io.cwd, outputDir)}\n`,
    );
  }
  return code;
}

/** How serious the exit code of one dictionary is, for the code of a directory. */
function rank(code: number): number {
  return code === EXIT.internal ? 3 : code === EXIT.plugin ? 2 : code === EXIT.ok ? 0 : 1;
}

/**
 * The options of `openDsl` for the shared command line options. Explicit companion paths are
 * resolved against the working directory, and loaded even with `--no-companions`.
 */
export function openOptions(
  options: ConvertOptions | InfoOptions,
  cwd: string,
): Omit<OpenDslOptions, 'diagnostics' | 'positions'> {
  const paths = {
    ...(options.abbreviations === undefined
      ? {}
      : { abbreviations: resolve(cwd, options.abbreviations) }),
    ...(options.annotation === undefined ? {} : { annotation: resolve(cwd, options.annotation) }),
  };
  return {
    ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
    ...(options.defaultEncoding === undefined ? {} : { defaultEncoding: options.defaultEncoding }),
    companions: options.companions
      ? true
      : {
          abbreviations: paths.abbreviations !== undefined,
          annotation: paths.annotation !== undefined,
          icon: false,
          media: false,
        },
    paths,
    strict: options.strict ?? false,
  };
}

/** Where a conversion writes: a file, or standard output (no path). */
interface Target {
  readonly path?: string;
}

/** The target of a single file: `-o`, a file in the `-o` directory, or standard output. */
function singleTarget(options: ConvertOptions, io: CliIo, input: string, label: string): Target {
  if (options.output === undefined) return {};
  const output = resolve(io.cwd, options.output);
  const name = `${dictionaryBaseName(input)}.${label}.${options.format}`;
  return options.output.endsWith('/') || options.output.endsWith(sep) || isDirectorySync(output)
    ? { path: join(output, name) }
    : { path: output };
}

function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Converts one dictionary. Failures are reported and give an exit code, not an exception, so
 * that a directory goes on with the next file; only a closed pipe ends the process quietly.
 */
async function convertOne(
  file: string,
  target: Target,
  options: ConvertOptions,
  plugin: AnyPlugin | undefined,
  pluginOptions: unknown,
  io: CliIo,
): Promise<number> {
  const name = displayPath(io.cwd, file);
  const reporter = createReporter(name, io.stderr, options.verbosity);
  const quiet = options.verbosity === 'quiet';
  let stream: Writable | undefined;
  let counts: (() => DiagnosticCounts) | undefined;
  try {
    const dict = await openDsl(file, {
      ...openOptions(options, io.cwd),
      positions: options.positions,
      diagnostics: reporter,
    });
    counts = () => dict.diagnosticCounts();
    const counter = { entries: 0 };
    const source = counting(dict, counter);
    const { summary, pretty } = options;
    let chunks: AsyncIterable<string>;
    if (plugin === undefined) {
      chunks =
        options.format === 'json'
          ? toJson(source, { summary, pretty })
          : toJsonl(source, { summary });
    } else {
      const use = { plugin, options: pluginOptions };
      chunks =
        options.format === 'json'
          ? toJson(source, { ...use, summary, pretty })
          : toJsonl(source, { ...use, summary });
    }

    if (target.path === undefined) {
      await writeChunks(io.stdout, chunks);
    } else {
      await mkdir(dirname(target.path), { recursive: true });
      stream = createWriteStream(target.path);
      // Errors reach us through writeChunks; this keeps a late one from being unhandled.
      stream.on('error', () => {});
      await writeChunks(stream, chunks);
      await endStream(stream);
      stream = undefined;
    }
    reporter.finish(counts());
    if (target.path !== undefined && !quiet) {
      io.stderr.write(
        `${name} -> ${displayPath(io.cwd, target.path)}: ${counter.entries} entries\n`,
      );
    }
    return EXIT.ok;
  } catch (error) {
    if (stream !== undefined) {
      await closed(stream);
      if (target.path !== undefined) await unlink(target.path).catch(() => {});
    }
    // The reader of standard output has gone: stop quietly, like head does.
    if (target.path === undefined && isBrokenPipe(error)) return EXIT.ok;
    reporter.finish(counts?.());
    io.stderr.write(`dsl-dicts: ${name}: ${describeError(error)}\n`);
    return exitCodeOf(error);
  }
}

/** Destroys a stream and waits until its file is closed. */
function closed(stream: Writable): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) return resolve();
    stream.once('close', () => resolve());
    stream.destroy();
  });
}

/** The dictionary with the entries counted as they are read. */
function counting(dict: ParsedDsl, counter: { entries: number }): ParsedDsl {
  return {
    get header() {
      return dict.header;
    },
    get info() {
      return dict.info;
    },
    get bodyMode() {
      return dict.bodyMode;
    },
    get diagnostics() {
      return dict.diagnostics;
    },
    diagnosticCounts: () => dict.diagnosticCounts(),
    entries: ((use?: PluginUse<unknown, unknown>) =>
      count(
        (use === undefined
          ? dict.entries()
          : (dict as ParsedDsl<DslEntry>).entries(use)) as AsyncIterable<unknown>,
        counter,
      )) as ParsedDsl['entries'],
    batches: dict.batches.bind(dict) as ParsedDsl['batches'],
  };
}

async function* count(entries: AsyncIterable<unknown>, counter: { entries: number }) {
  for await (const entry of entries) {
    counter.entries++;
    yield entry;
  }
}
