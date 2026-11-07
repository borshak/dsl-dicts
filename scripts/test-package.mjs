/**
 * Packs the package, installs the tarball into a throwaway project and checks it the way a
 * consumer would: `require()` (require(esm)) and `import` of every entry point, and the bin.
 *
 * Run after `npm run build`.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

if (!existsSync(join(root, 'dist', 'index.js'))) {
  throw new Error('dist is missing: run "npm run build" first');
}

/** Runs npm; uses the npm that runs this script when there is one (works on Windows too). */
function npm(args, cwd) {
  const execPath = process.env.npm_execpath;
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  return execPath?.endsWith('.js')
    ? execFileSync(process.execPath, [execPath, ...args], options)
    : execFileSync('npm', args, { ...options, shell: isWindows });
}

function node(args, cwd) {
  return execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

// Expectations per entry point: [specifier, export name, expected value or null (existence only)].
const entries = [
  ['dsl-dicts', 'VERSION', version],
  ['dsl-dicts', 'parseDsl', null],
  ['dsl-dicts', 'createDictionaryContext', null],
  ['dsl-dicts', 'definePlugin', null],
  ['dsl-dicts', 'setupPlugin', null],
  ['dsl-dicts', 'toPlainText', null],
  ['dsl-dicts', 'zoneText', null],
  ['dsl-dicts/node', 'describeRuntime', null],
  ['dsl-dicts/article', 'MODULE', 'article'],
  ['dsl-dicts/plugins', 'plainText', null],
  ['dsl-dicts/plugins', 'searchText', null],
];

// Besides the exports: the built-in plugins run on the packed core, through parseDsl.
const checkBody = `
for (const [specifier, name, expected] of ${JSON.stringify(entries)}) {
  const mod = await load(specifier);
  assert.ok(name in mod, specifier + ' must export ' + name);
  if (expected !== null) assert.equal(mod[name], expected, specifier + ' ' + name);
}
console.log('ok exports');
const { parseDsl } = await load('dsl-dicts');
const { plainText, searchText } = await load('dsl-dicts/plugins');
const text = '#NAME "t"\\n#INDEX_LANGUAGE "English"\\n#CONTENTS_LANGUAGE "English"\\n' +
  'colo(u)r\\n\\t[m1][b]~[/b] [trn]hue[/trn]\\n';
const results = [];
for (const plugin of [plainText, searchText]) {
  for await (const out of parseDsl(text).entries({ plugin })) results.push(out);
}
assert.deepEqual(results, [
  { headwords: ['colo(u)r'], text: 'color hue' },
  { headwords: ['color', 'colour'], text: 'hue' },
]);
console.log('ok plugins', plainText.name + '@' + plainText.version, searchText.name + '@' + searchText.version);
`;

// CommonJS has no top-level await: wrap the shared body in an async function.
const cjsCheck = `const assert = require('node:assert/strict');
const load = async (specifier) => require(specifier);
(async () => {${checkBody}})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
const esmCheck = `import assert from 'node:assert/strict';
const load = (specifier) => import(specifier);
${checkBody}`;

const temp = mkdtempSync(join(tmpdir(), 'dsl-dicts-package-'));
try {
  const packDir = join(temp, 'pack');
  const project = join(temp, 'project');
  mkdirSync(packDir);
  mkdirSync(project);

  npm(['pack', '--pack-destination', packDir, '--silent'], root);
  const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('npm pack produced no tarball');

  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  npm(['install', join(packDir, tarball), '--no-audit', '--no-fund', '--ignore-scripts'], project);

  // CommonJS consumer: require(esm), which also fails on top-level await.
  writeFileSync(join(project, 'check.cjs'), cjsCheck);
  process.stdout.write(`CJS require()\n${node(['check.cjs'], project)}`);

  // ESM consumer.
  writeFileSync(join(project, 'check.mjs'), esmCheck);
  process.stdout.write(`ESM import()\n${node(['check.mjs'], project)}`);

  // The bin, as installed in node_modules/.bin.
  const bin = join(project, 'node_modules', '.bin', isWindows ? 'dsl-dicts.cmd' : 'dsl-dicts');
  const printed = (
    isWindows
      ? execFileSync(`"${bin}" --version`, { cwd: project, encoding: 'utf8', shell: true })
      : execFileSync(bin, ['--version'], { cwd: project, encoding: 'utf8' })
  ).trim();
  if (printed !== version)
    throw new Error(`dsl-dicts --version printed "${printed}", expected "${version}"`);
  console.log(`bin dsl-dicts --version: ${printed}`);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
