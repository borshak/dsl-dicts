/**
 * `dsl-dicts convert`.
 *
 * @packageDocumentation
 */

import { createWriteStream, statSync } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';
import { type DslEntry, type ParsedDsl, type PluginUse, toJson, toJsonl } from '../../index.js';
import { findDictionaries } from '../find.js';
import { dictionaryBaseName } from '../names.js';
import { openDsl } from '../open.js';
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
import type { ConvertOptions } from './options.js';
import { endStream, writeChunks } from './output.js';
import { type AnyPlugin, loadPlugin, parsePluginOptions, pluginOfView } from './plugins.js';
import { createReporter, type Verbosity } from './report.js';

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
    options.plugin === undefined
      ? pluginOfView(options.view ?? 'ast')
      : await loadPlugin(options.plugin, io.cwd);
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
    // A plugin failure outranks the failures of dictionaries.
    else if (code !== EXIT.plugin) code = result;
  }
  if (!options.quiet) {
    io.stderr.write(
      `Converted ${converted} of ${files.length} dictionaries to ${displayPath(io.cwd, outputDir)}\n`,
    );
  }
  return code;
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
  const verbosity: Verbosity = options.quiet ? 'quiet' : options.verbose ? 'verbose' : 'summary';
  const name = displayPath(io.cwd, file);
  const reporter = createReporter(name, io.stderr, verbosity);
  let stream: Writable | undefined;
  try {
    const dict = await openDsl(file, {
      ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
      ...(options.defaultEncoding === undefined
        ? {}
        : { defaultEncoding: options.defaultEncoding }),
      positions: options.positions,
      companions: options.companions,
      strict: options.strict,
      diagnostics: reporter,
    });
    const counter = { entries: 0 };
    const source = counting(dict, counter);
    const exportOptions = {
      ...(plugin === undefined ? {} : { plugin, options: pluginOptions }),
      summary: options.summary,
      tally: reporter.tally,
    };
    const chunks =
      options.format === 'json'
        ? toJson(source, { ...exportOptions, pretty: options.pretty })
        : toJsonl(source, exportOptions);

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
    reporter.finish();
    if (target.path !== undefined && !options.quiet) {
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
    reporter.finish();
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
    get diagnostics() {
      return dict.diagnostics;
    },
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
