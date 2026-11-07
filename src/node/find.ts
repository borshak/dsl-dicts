/**
 * `findDictionaries`: lists the dictionary files of a directory.
 *
 * @packageDocumentation
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DslError } from '../index.js';
import { isAbbreviationsName, isDictionaryName } from './names.js';

/**
 * Options of {@link findDictionaries}.
 *
 * @experimental
 */
export interface FindDictionariesOptions {
  /** Look in subdirectories too. Default `false`. Symbolic links to directories are not followed. */
  readonly recursive?: boolean;
}

/**
 * Lists the main dictionary files of a directory: the files named `*.dsl`, `*.dsl.dz` or
 * `*.dsl.gz`, in any letter case, except abbreviations files (`*_abrv.dsl`, `*_abrv.dsl.dz`).
 * Companion files with other extensions, and directories, are not listed. If a dictionary
 * exists both as `foo.dsl` and as `foo.dsl.dz`, both are listed.
 *
 * @returns The paths, each the directory joined with the file's name (relative if `directory`
 * is). In a directory the files are sorted by name and come before those of its
 * subdirectories, which are visited in name order.
 * @throws DslError `DSL0001` for invalid arguments; `DSL1001` if `directory` cannot be read.
 * Subdirectories that cannot be read are skipped.
 * @experimental
 */
export async function findDictionaries(
  directory: string,
  options: FindDictionariesOptions = {},
): Promise<string[]> {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw DslError.of('invalidArgument', 'The directory must be a non-empty string.');
  }
  if (typeof options !== 'object' || options === null) {
    throw DslError.of('invalidArgument', 'Options must be an object.');
  }
  const { recursive = false } = options;
  if (typeof recursive !== 'boolean') {
    throw DslError.of('invalidArgument', 'The recursive option must be a boolean.');
  }
  const found: string[] = [];
  await walk(directory, recursive, found, true);
  return found;
}

async function walk(
  directory: string,
  recursive: boolean,
  found: string[],
  root: boolean,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (root) throw DslError.of('readFailed', `Cannot read the directory ${directory}.`, error);
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const directories: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (recursive) directories.push(join(directory, entry.name));
    } else if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      isDictionaryName(entry.name) &&
      !isAbbreviationsName(entry.name)
    ) {
      found.push(join(directory, entry.name));
    }
  }
  for (const sub of directories) await walk(sub, recursive, found, false);
}
