/**
 * The plugin of a conversion: a built-in one by name, or a module loaded from a path.
 *
 * @packageDocumentation
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { article } from '../../article/index.js';
import { DslError, type DslPlugin, definePlugin } from '../../index.js';
import { plainText, searchText } from '../../plugins/index.js';
import { CliError, EXIT, usageError } from './errors.js';

/** A plugin whose types are not known. */
export type AnyPlugin = DslPlugin<unknown, unknown>;

/** The names of the views: `ast` is the AST itself, the others are built-in plugins. */
export const VIEWS = ['ast', 'article', 'plain-text', 'search-text'] as const;

/** A view: what is exported. */
export type View = (typeof VIEWS)[number];

/** Whether a string names a view. */
export function isView(value: string): value is View {
  return (VIEWS as readonly string[]).includes(value);
}

/** The built-in plugin of a view; `undefined` for `ast`. */
export function pluginOfView(view: View): AnyPlugin | undefined {
  switch (view) {
    case 'ast':
      return undefined;
    case 'article':
      return article as AnyPlugin;
    case 'plain-text':
      return plainText as AnyPlugin;
    case 'search-text':
      return searchText as AnyPlugin;
  }
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
