/**
 * Packs the package, installs the tarball into a throwaway project and checks it the way a
 * consumer would: `require()` (require(esm)) and `import` of every entry point, and the bin, which
 * converts a synthetic dictionary whose output is read back with the installed `readJsonl`.
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
  ['dsl-dicts', 'parseAbbreviations', null],
  ['dsl-dicts', 'parseAnnotation', null],
  ['dsl-dicts', 'normalizeLabel', null],
  ['dsl-dicts', 'toJsonl', null],
  ['dsl-dicts', 'toJson', null],
  ['dsl-dicts', 'readJsonl', null],
  ['dsl-dicts', 'parseJsonlHeader', null],
  ['dsl-dicts', 'createJsonlHeader', null],
  ['dsl-dicts', 'createDiagnosticTally', null],
  ['dsl-dicts', 'JSONL_FORMAT', 'dsl-dicts/jsonl'],
  ['dsl-dicts', 'JSONL_FORMAT_VERSION', 1],
  ['dsl-dicts/node', 'describeRuntime', null],
  ['dsl-dicts/node', 'openDsl', null],
  ['dsl-dicts/node', 'findDictionaries', null],
  ['dsl-dicts/article', 'ARTICLE_VERSION', '1.0.0'],
  ['dsl-dicts/article', 'article', null],
  ['dsl-dicts/article', 'createArticlePlugin', null],
  ['dsl-dicts/article', 'classifyBody', null],
  ['dsl-dicts/article', 'DEFAULT_EXTRACTORS', null],
  ['dsl-dicts/article', 'extractZoneMarked', null],
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

// The article plugin, through parseDsl, and a custom extractor.
const { article, createArticlePlugin, extractZoneMarked } = await load('dsl-dicts/article');
const articles = [];
const dictText = text + 'cat\\n\\t[m1]1) [p]n[/p] [trn]кошка; кот[/trn]\\n\\t[m2][ex][lang id=1033]a cat[/lang] — кошка[/ex]\\n';
for await (const out of parseDsl(dictText).entries({ plugin: article })) articles.push(out);
assert.deepEqual(articles.map((a) => a.kind), ['zone-marked', 'zone-marked']);
assert.deepEqual(articles[1].senses, [{
  number: '1',
  labels: [{ text: 'n' }],
  translations: ['кошка', 'кот'],
  examples: [{ source: { text: 'a cat', language: 'English' }, target: { text: 'кошка', language: 'English' } }],
  comments: [],
  references: [],
  senses: [],
}]);
const custom = createArticlePlugin({ name: 'custom', extractors: { mine: extractZoneMarked }, classify: () => 'mine' });
const [first] = await (async () => { const list = []; for await (const out of parseDsl(dictText).entries({ plugin: custom })) list.push(out); return list; })();
assert.equal(first.kind, 'mine');
console.log('ok article', article.name + '@' + article.version);

// Companion parsers of the core, on text.
const { parseAbbreviations, parseAnnotation, normalizeLabel } = await load('dsl-dicts');
const abbreviations = await parseAbbreviations('#NAME "a"\\nadj.\\n\\tadjective\\n');
assert.deepEqual([...abbreviations], [['adj.', 'adjective']]);
const annotation = await parseAnnotation('#LANGUAGE "English"\\nHello\\n');
assert.equal(annotation.text, 'Hello');
assert.equal(annotation.sections[0].language.iso639_1, 'en');
assert.equal(normalizeLabel('  a \\t b '), 'a b');
console.log('ok companion parsers');

// The Node adapter, end to end: a gzipped dictionary with its companion files in a temp directory.
const { openDsl, findDictionaries } = await load('dsl-dicts/node');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-dicts-open-'));
try {
  const header = '#NAME "a"\\n#INDEX_LANGUAGE "English"\\n#CONTENTS_LANGUAGE "English"\\n';
  const utf16 = (value) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')]);
  fs.writeFileSync(path.join(directory, 'syn.dsl.dz'), zlib.gzipSync(Buffer.from(text + 'cat\\n\\t[m1][p]n[/p] [trn]cat[/trn]\\n')));
  fs.writeFileSync(path.join(directory, 'syn_ABRV.DSL'), utf16(header + 'n\\n\\tnoun\\n'));
  fs.writeFileSync(path.join(directory, 'syn.ann'), utf16('#LANGUAGE "English"\\nSynthetic.\\n'));
  fs.writeFileSync(path.join(directory, 'syn.bmp'), Buffer.from('BM'));
  fs.writeFileSync(path.join(directory, 'syn_abrv.dsl.dz'), Buffer.alloc(0));
  assert.deepEqual(await findDictionaries(directory), [path.join(directory, 'syn.dsl.dz')]);
  const dict = await openDsl(path.join(directory, 'syn.dsl.dz'));
  assert.deepEqual(Object.keys(dict.files), ['dictionary', 'abbreviations', 'annotation', 'icon']);
  assert.equal(path.basename(dict.files.abbreviations), 'syn_ABRV.DSL');
  assert.equal((await dict.info).compression, 'gzip');
  const out = [];
  for await (const entry of dict.entries({ plugin: plainText, options: { expandLabels: true } })) out.push(entry);
  assert.deepEqual(out.at(-1), { headwords: ['cat'], text: 'noun cat' });
  assert.equal(dict.annotation.text, 'Synthetic.');
  assert.deepEqual(dict.diagnostics, []);
  console.log('ok openDsl', out.length, 'entries');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
`;

// CommonJS has no top-level await: wrap the shared body in an async function.
const cjsCheck = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const load = async (specifier) => require(specifier);
(async () => {${checkBody}})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
const esmCheck = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
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

  // The bin converts a dictionary; the installed reader validates the output.
  const dictionary = join(project, 'syn.dsl');
  writeFileSync(
    dictionary,
    '#NAME "Syn"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "Russian"\n' +
      'cat\n\t[m1][p]n[/p] [trn]кошка[/trn]\ndog\n\t[m1][trn]собака[/trn]\n',
  );
  const run = (...args) =>
    isWindows
      ? execFileSync(`"${bin}" ${args.map((a) => `"${a}"`).join(' ')}`, {
          cwd: project,
          encoding: 'utf8',
          shell: true,
        })
      : execFileSync(bin, args, { cwd: project, encoding: 'utf8' });
  const outputs = {};
  for (const view of ['article', 'ast']) {
    outputs[view] = run('convert', dictionary, '--view', view, '--summary');
  }
  writeFileSync(join(project, 'outputs.json'), JSON.stringify(outputs));
  const checkConvert = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AST_VERSION, readJsonl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';
const outputs = JSON.parse(readFileSync('outputs.json', 'utf8'));
for (const [view, text] of Object.entries(outputs)) {
  const expect = view === 'ast'
    ? { astVersion: AST_VERSION, plugin: null }
    : { astVersion: AST_VERSION, plugin: { name: article.name, version: article.version } };
  const { header, records } = await readJsonl([text], expect);
  assert.equal(header.dictionary.name, 'Syn');
  const list = [];
  for await (const record of records) list.push(record);
  assert.deepEqual(list.map((r) => r.type), ['entry', 'entry', 'summary']);
  assert.equal(list.at(-1).entries, 2);
  if (view === 'article') assert.deepEqual(list[0].data.senses[0].translations, ['кошка']);
  else assert.equal(list[1].data.headwords[0].text, 'dog');
  console.log('ok convert --view', view, list.length, 'records');
}
`;
  writeFileSync(join(project, 'check-convert.mjs'), checkConvert);
  process.stdout.write(node(['check-convert.mjs'], project));
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
