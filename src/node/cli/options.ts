/**
 * Command line parsing of `convert` and `info`.
 *
 * @packageDocumentation
 */

import { parseArgs } from 'node:util';
import { usageError } from './errors.js';
import { isView, VIEWS, type View } from './plugins.js';

/** The options of `dsl-dicts convert`, checked. */
export interface ConvertOptions {
  readonly path: string;
  readonly output: string | undefined;
  readonly format: 'jsonl' | 'json';
  readonly pretty: boolean;
  /** The built-in view, `undefined` when `plugin` is set. */
  readonly view: View | undefined;
  readonly plugin: string | undefined;
  readonly pluginOptions: string | undefined;
  readonly encoding: string | undefined;
  readonly defaultEncoding: string | undefined;
  readonly positions: boolean;
  readonly companions: boolean;
  readonly strict: boolean;
  readonly summary: boolean;
  readonly recursive: boolean;
  readonly verbose: boolean;
  readonly quiet: boolean;
}

/** The options of `dsl-dicts info`, checked. */
export interface InfoOptions {
  readonly path: string;
  readonly json: boolean;
  readonly encoding: string | undefined;
  readonly defaultEncoding: string | undefined;
  readonly companions: boolean;
}

function parse<T extends Record<string, { type: 'string' | 'boolean'; short?: string }>>(
  args: readonly string[],
  options: T,
) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
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

/** Parses the arguments of `convert`; `help` is true if `--help` was given. */
export function parseConvert(args: readonly string[]): ConvertOptions | 'help' {
  const { values, positionals } = parse(args, {
    output: { type: 'string', short: 'o' },
    format: { type: 'string' },
    pretty: { type: 'boolean' },
    view: { type: 'string' },
    plugin: { type: 'string' },
    'plugin-options': { type: 'string' },
    encoding: { type: 'string' },
    'default-encoding': { type: 'string' },
    'no-positions': { type: 'boolean' },
    'no-companions': { type: 'boolean' },
    strict: { type: 'boolean' },
    summary: { type: 'boolean' },
    recursive: { type: 'boolean' },
    verbose: { type: 'boolean' },
    quiet: { type: 'boolean', short: 'q' },
    help: { type: 'boolean', short: 'h' },
  });
  if (values.help) return 'help';
  const path = onePath(positionals, 'convert', 'dictionary file or directory');
  const format = values.format ?? 'jsonl';
  if (format !== 'jsonl' && format !== 'json') {
    throw usageError(`--format must be jsonl or json, not ${format}.`);
  }
  if (values.view !== undefined && !isView(values.view)) {
    throw usageError(`--view must be one of ${VIEWS.join(', ')}, not ${values.view}.`);
  }
  if (values.view !== undefined && values.plugin !== undefined) {
    throw usageError('--view and --plugin cannot be used together.');
  }
  const view =
    values.plugin === undefined ? ((values.view as View | undefined) ?? 'ast') : undefined;
  if (values['plugin-options'] !== undefined && view === 'ast') {
    throw usageError('--plugin-options needs a plugin: use --view or --plugin.');
  }
  if (values.pretty && format !== 'json') throw usageError('--pretty needs --format json.');
  if (values.verbose && values.quiet)
    throw usageError('--verbose and --quiet cannot be used together.');
  return {
    path,
    output: values.output,
    format,
    pretty: values.pretty ?? false,
    view,
    plugin: values.plugin,
    pluginOptions: values['plugin-options'],
    encoding: values.encoding,
    defaultEncoding: values['default-encoding'],
    positions: !values['no-positions'],
    companions: !values['no-companions'],
    strict: values.strict ?? false,
    summary: values.summary ?? false,
    recursive: values.recursive ?? false,
    verbose: values.verbose ?? false,
    quiet: values.quiet ?? false,
  };
}

/** Parses the arguments of `info`; `help` is true if `--help` was given. */
export function parseInfo(args: readonly string[]): InfoOptions | 'help' {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean' },
    encoding: { type: 'string' },
    'default-encoding': { type: 'string' },
    'no-companions': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  });
  if (values.help) return 'help';
  return {
    path: onePath(positionals, 'info', 'dictionary file'),
    json: values.json ?? false,
    encoding: values.encoding,
    defaultEncoding: values['default-encoding'],
    companions: !values['no-companions'],
  };
}
