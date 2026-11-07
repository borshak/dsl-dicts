/**
 * The plugin of a conversion: a built-in one by name, or a module loaded from a path.
 *
 * @packageDocumentation
 */

import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { article } from '../../article/index.js';
import { DslError, type DslPlugin, definePlugin } from '../../index.js';
import { plainText, searchText } from '../../plugins/index.js';
import { CliError, EXIT, usageError } from './errors.js';

/** A plugin whose types are not known. */
export type AnyPlugin = DslPlugin<unknown, unknown>;

/** The built-in plugins, by the name `--plugin` takes. */
export const BUILT_IN_PLUGINS: Readonly<Record<string, AnyPlugin>> = {
  article: article as AnyPlugin,
  'plain-text': plainText as AnyPlugin,
  'search-text': searchText as AnyPlugin,
};

/**
 * Whether a `--plugin` value is the path of a module rather than a built-in name: it has a
 * path separator, or ends with `.js` or `.mjs`.
 */
export function isPluginPath(value: string): boolean {
  return value.includes('/') || value.includes(sep) || /\.m?js$/i.test(value);
}

/**
 * The plugin a `--plugin` value names: a built-in plugin, or the default export of a module.
 *
 * @throws CliError with exit code 1 for an unknown name, 3 if the module cannot be loaded or
 * exports no valid plugin.
 */
export async function resolvePlugin(value: string, cwd: string): Promise<AnyPlugin> {
  if (isPluginPath(value)) return loadPlugin(value, cwd);
  const plugin = Object.hasOwn(BUILT_IN_PLUGINS, value) ? BUILT_IN_PLUGINS[value] : undefined;
  if (plugin === undefined) {
    throw usageError(
      `Unknown plugin ${value}: use ${Object.keys(BUILT_IN_PLUGINS).join(', ')}, or the path ` +
        'of a plugin module (such as ./my-plugin.js). Leave --plugin out for the AST.',
    );
  }
  return plugin;
}

/**
 * Loads a plugin from an ES module, the default export of which is a `DslPlugin`. The code of
 * the module is run.
 *
 * @throws CliError with exit code 3 if the module cannot be loaded or exports no valid plugin.
 */
export async function loadPlugin(path: string, cwd: string): Promise<AnyPlugin> {
  const file = resolve(cwd, path);
  let loaded: { default?: unknown };
  try {
    loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(EXIT.plugin, `Cannot load the plugin ${file}: ${reason}`, { cause: error });
  }
  if (loaded.default === undefined) {
    throw new CliError(
      EXIT.plugin,
      `The plugin ${file} has no default export: export a DslPlugin by default.`,
    );
  }
  try {
    return definePlugin(loaded.default as AnyPlugin);
  } catch (error) {
    const reason = error instanceof DslError ? error.message : String(error);
    throw new CliError(EXIT.plugin, `The default export of ${file} is not a plugin: ${reason}`, {
      cause: error,
    });
  }
}

/** Parses the `--plugin-options` JSON. */
export function parsePluginOptions(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw usageError(
      `--plugin-options is not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}
