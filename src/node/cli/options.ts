/**
 * Command line parsing of `convert` and `info`.
 *
 * @packageDocumentation
 */

import { parseArgs } from 'node:util';
import type { Severity } from '../../index.js';
import { usageError } from './errors.js';

/** How much of the diagnostics is printed to standard error. */
export type Verbosity = 'quiet' | 'summary' | 'verbose';

/** The options that `convert` and `info` share, checked. */
interface CommonOptions {
  readonly path: string;
  readonly encoding: string | undefined;
  readonly defaultEncoding: string | undefined;
  /** Explicit path of the abbreviations file, relative to the working directory. */
  readonly abbreviations: string | undefined;
  /** Explicit path of the annotation file, relative to the working directory. */
  readonly annotation: string | undefined;
  readonly companions: boolean;
  /** The strict severity, `undefined` without `--strict`. */
  readonly strict: Severity | undefined;
  readonly verbosity: Verbosity;
}

/** The options of `dsl-dicts convert`, checked. */
export interface ConvertOptions extends CommonOptions {
  readonly output: string | undefined;
  readonly format: 'jsonl' | 'json';
  readonly pretty: boolean;
  /** A built-in plugin name or a module path; `undefined` exports the AST. */
  readonly plugin: string | undefined;
  readonly pluginOptions: string | undefined;
  readonly positions: boolean;
  readonly summary: boolean;
  readonly recursive: boolean;
}

/** The options of `dsl-dicts info`, checked. */
export interface InfoOptions extends CommonOptions {
  readonly format: 'text' | 'json';
}

type Spec = Record<string, { type: 'string' | 'boolean'; short?: string }>;

/** The options both commands take. */
const COMMON = {
  encoding: { type: 'string' },
  'default-encoding': { type: 'string' },
  abbreviations: { type: 'string' },
  annotation: { type: 'string' },
  'no-companions': { type: 'boolean' },
  verbose: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies Spec;

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

/**
 * Takes `--strict` and `--strict=<severity>` out of the arguments (the last one wins); a
 * boolean option of `parseArgs` cannot have an optional value.
 */
function takeStrict(args: readonly string[]): {
  rest: string[];
  strict: Severity | undefined;
} {
  const rest: string[] = [];
  let strict: Severity | undefined;
  let options = true;
  for (const arg of args) {
    if (options && arg === '--') options = false;
    if (options && arg === '--strict') {
      strict = 'error';
    } else if (options && arg.startsWith('--strict=')) {
      const value = arg.slice('--strict='.length);
      if (!(SEVERITIES as readonly string[]).includes(value)) {
        throw usageError(`--strict must be error, warning or info, not ${value || '(empty)'}.`);
      }
      strict = value as Severity;
    } else {
      rest.push(arg);
    }
  }
  return { rest, strict };
}

function parse<T extends Spec>(args: readonly string[], options: T) {
  const { rest, strict } = takeStrict(args);
  try {
    const parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true });
    return { ...parsed, strict };
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error));
  }
}

function onePath(positionals: readonly string[], command: string, what: string): string {
  const [path, ...extra] = positionals;
  if (path === undefined) throw usageError(`${command}: missing ${what}.`);
  if (extra.length > 0) throw usageError(`${command}: unexpected argument ${extra[0]}.`);
  return path;
}

/** The common options, from the parsed values. */
function common(
  values: {
    readonly encoding?: string | undefined;
    readonly 'default-encoding'?: string | undefined;
    readonly abbreviations?: string | undefined;
    readonly annotation?: string | undefined;
    readonly 'no-companions'?: boolean | undefined;
    readonly verbose?: boolean | undefined;
    readonly quiet?: boolean | undefined;
  },
  path: string,
  strict: Severity | undefined,
  quietByDefault: boolean,
): CommonOptions {
  if (values.verbose && values.quiet) {
    throw usageError('--verbose and --quiet cannot be used together.');
  }
  return {
    path,
    encoding: values.encoding,
    defaultEncoding: values['default-encoding'],
    abbreviations: values.abbreviations,
    annotation: values.annotation,
    companions: !values['no-companions'],
    strict,
    verbosity: values.verbose ? 'verbose' : values.quiet || quietByDefault ? 'quiet' : 'summary',
  };
}

/** Parses the arguments of `convert`; `help` if `--help` was given. */
export function parseConvert(args: readonly string[]): ConvertOptions | 'help' {
  const { values, positionals, strict } = parse(args, {
    ...COMMON,
    output: { type: 'string', short: 'o' },
    format: { type: 'string' },
    pretty: { type: 'boolean' },
    plugin: { type: 'string' },
    'plugin-options': { type: 'string' },
    'no-positions': { type: 'boolean' },
    summary: { type: 'boolean' },
    recursive: { type: 'boolean' },
  });
  if (values.help) return 'help';
  const path = onePath(positionals, 'convert', 'dictionary file or directory');
  const format = values.format ?? 'jsonl';
  if (format !== 'jsonl' && format !== 'json') {
    throw usageError(`--format must be jsonl or json, not ${format}.`);
  }
  if (values.plugin === '') throw usageError('--plugin needs a plugin name or a module path.');
  if (values['plugin-options'] !== undefined && values.plugin === undefined) {
    throw usageError('--plugin-options needs --plugin.');
  }
  if (values.pretty && format !== 'json') throw usageError('--pretty needs --format json.');
  return {
    ...common(values, path, strict, false),
    output: values.output,
    format,
    pretty: values.pretty ?? false,
    plugin: values.plugin,
    pluginOptions: values['plugin-options'],
    positions: !values['no-positions'],
    summary: values.summary ?? false,
    recursive: values.recursive ?? false,
  };
}

/** Parses the arguments of `info`; `help` if `--help` was given. */
export function parseInfo(args: readonly string[]): InfoOptions | 'help' {
  const { values, positionals, strict } = parse(args, {
    ...COMMON,
    format: { type: 'string' },
  });
  if (values.help) return 'help';
  const format = values.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw usageError(`--format must be text or json, not ${format}.`);
  }
  // The report lists the diagnostics by code: standard error stays quiet unless --verbose.
  return {
    ...common(values, onePath(positionals, 'info', 'dictionary file'), strict, true),
    format,
  };
}
