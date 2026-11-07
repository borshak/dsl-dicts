import { readFile } from 'node:fs/promises';
import { parseDsl } from 'dsl-dicts';

const bytes = await readFile('dictionaries/old-de.dsl');

// An 8-bit file without #SOURCE_CODE_PAGE: say which code page to fall back to.
const fallback = parseDsl(bytes, { defaultEncoding: 'Latin' });
console.log(await fallback.info); // { encoding: 'windows-1252', source: 'default', ... }

// Detection goes wrong: force the encoding (no BOM sniffing, heuristics or directive).
const forced = parseDsl(bytes, { encoding: 'windows-1252' });
console.log((await forced.info).source); // 'option'
