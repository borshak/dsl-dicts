/**
 * `findDictionaries`: lists the dictionary files of a directory.
 *
 * @packageDocumentation
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DslError } from '../index.js';
import { dictionaryBaseName, isAbbreviationsName, isDictionaryName } from './names.js';

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
 * Companion files with other extensions, and directories, are not listed. A dictionary that
 * exists in several forms, such as `foo.dsl` and `foo.dsl.dz` (they have the same base name,
 * in any letter case, and the same directory), is listed once, as the uncompressed `.dsl`,
 * else the `.dsl.dz`, else the `.dsl.gz`.
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
  entries.sort((a, b) => compare(a.name, b.name));
  const directories: string[] = [];
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (recursive) directories.push(join(directory, entry.name));
    } else if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      isDictionaryName(entry.name) &&
      !isAbbreviationsName(entry.name)
    ) {
      names.push(entry.name);
    }
  }
  for (const name of preferred(names)) found.push(join(directory, name));
  for (const sub of directories) await walk(sub, recursive, found, false);
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Extensions in order of preference, longest first as in `names.ts`. */
const FORMS = ['.dsl', '.dsl.dz', '.dsl.gz'];

/** Rank of a name among the forms of one dictionary: smaller is preferred. */
function rank(name: string): [form: number, spelling: number] {
  const lower = name.toLowerCase();
  const form = FORMS.findIndex((extension) => lower.endsWith(extension));
  // The extension in lower case comes first.
  return [form, name.endsWith(FORMS[form] as string) ? 0 : 1];
}

/** One name per dictionary (base name in any case), the most preferred form; sorted names in, out. */
function preferred(names: readonly string[]): string[] {
  const best = new Map<string, string>();
  for (const name of names) {
    const key = dictionaryBaseName(name).normalize('NFC').toLowerCase();
    const current = best.get(key);
    if (current !== undefined) {
      const [a, b] = [rank(name), rank(current)];
      if (a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1])) continue;
    }
    best.set(key, name);
  }
  const chosen = new Set(best.values());
  return names.filter((name) => chosen.has(name));
}
