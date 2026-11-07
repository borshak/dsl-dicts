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
  ['dsl-dicts/node', 'describeRuntime', null],
  ['dsl-dicts/article', 'MODULE', 'article'],
  ['dsl-dicts/plugins', 'MODULE', 'plugins'],
];

const checkBody = `
for (const [specifier, name, expected] of ${JSON.stringify(entries)}) {
  const mod = await load(specifier);
  assert.ok(name in mod, specifier + ' must export ' + name);
  if (expected !== null) assert.equal(mod[name], expected, specifier + ' ' + name);
  console.log('ok', specifier);
}
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
