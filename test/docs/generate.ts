/**
 * The generated parts of the documentation, and the update of a document from them.
 *
 * Markers in the Markdown files say what is generated:
 * - `<!-- example: name -->` before a code block: the block is `test/docs/examples/name.ts`
 *   (or `.mjs`), which the tests run.
 * - `<!-- generated: name -->` ... `<!-- end: name -->`: the lines in between are
 *   `GENERATED[name]`.
 * - `<!-- block: name -->` before a code block: hand-written, checked by a test.
 * - `<!-- legacy -->` before a code block: code of dsl-dicts 1.x, not checked.
 *
 * `npm run docs` rewrites the documents (and `docs/diagnostics.md`) with `sync.test.ts`, whose
 * file snapshots fail when a document is out of date.
 */

import { TAGS, type TagSpec } from '../../src/data/tags.js';
import {
  DIAGNOSTICS,
  type DiagnosticSpec,
  parseDsl,
  parseHeadword,
  parseMarkup,
  toJsonl,
} from '../../src/index.js';
import { CONVERT_USAGE, INFO_USAGE, USAGE } from '../../src/node/cli/usage.js';
import { VERSION } from '../../src/version.js';

import { collect } from './helpers.js';

export { blocksOf } from './helpers.js';

/** The version in generated samples: the release a prerelease leads to. */
const RELEASE = VERSION.replace(/-.*$/, '');

/** A fenced code block. */
function fence(language: string, text: string): string {
  return `\`\`\`${language}\n${text.replace(/\n$/, '')}\n\`\`\``;
}

/** JSON with two-space indentation, objects and arrays that fit in `width` on one line. */
export function compactJson(value: unknown, indent = '', width = 80): string {
  const flat = oneLine(value);
  if (value === null || typeof value !== 'object' || indent.length + flat.length <= width) {
    return flat;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => inner + compactJson(item, inner, width)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const fields = entries.map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${compactJson(item, inner, width)}`,
  );
  return `{\n${fields.join(',\n')}\n${indent}}`;
}

/** A value as JSON on one line, with a space after colons and commas, inside braces. */
function oneLine(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(oneLine).join(', ')}]`;
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${oneLine(item)}`).join(', ')} }`;
}

/** Escapes text for a Markdown table cell: DSL markup is full of Markdown syntax. */
function cell(text: string): string {
  return text.replace(/[\\`*_~[\]<>|]/g, (c) => `\\${c}`);
}

const RANGES: readonly (readonly [prefix: string, title: string, intro: string])[] = [
  [
    'DSL0',
    'DSL0xxx: API usage',
    'Invalid arguments, misuse of single-use results, and cancellation.',
  ],
  [
    'DSL1',
    'DSL1xxx: input, decompression and encoding',
    'Reading the source, gzip and dictzip decompression, encoding detection and decoding.',
  ],
  [
    'DSL2',
    'DSL2xxx: segmentation',
    'The header and its directives, entries, sub-entries and `{{...}}` comments.',
  ],
  ['DSL3', 'DSL3xxx: headwords', 'Braces, parentheses, `~` and markup in headwords; limits.'],
  ['DSL4', 'DSL4xxx: body markup', 'Tags, links, escapes and the recovery of malformed markup.'],
  [
    'DSL5',
    'DSL5xxx: plugins',
    '`DSL50xx` are failures of a plugin, thrown as a `DslError` whose `plugin` names it; ' +
      '`DSL51xx` are what plugins report through `DictionaryContext.diagnostics`.',
  ],
  [
    'DSL6',
    'DSL6xxx: companion files',
    '`DSL60xx` are problems in the content of an abbreviations file (`parseAbbreviations`); ' +
      '`DSL61xx` are problems finding or reading the files next to a dictionary ' +
      '(`dsl-dicts/node`).',
  ],
  [
    'DSL7',
    'DSL7xxx: serialization',
    'A JSONL document this version cannot read (`readJsonl`), or output that cannot be ' +
      'serialized (`toJsonl`, `toJson`).',
  ],
];

/** `docs/diagnostics.md`. */
export function renderDiagnostics(): string {
  const specs = [...DIAGNOSTICS.values()];
  const lines = [
    '# Diagnostics',
    '',
    '<!-- Generated from src/diagnostics/catalog.ts by `npm run docs`: do not edit. -->',
    '',
    'Every problem dsl-dicts finds has a code, `DSL` and four digits. This page lists them all,',
    `${specs.length} in this version, with their default severity and whether they are reported or thrown.`,
    'The same table is available at run time as `DIAGNOSTICS` (`findDiagnosticSpec(code)`).',
    '',
    '- **Reported** diagnostics are plain objects (`Diagnostic`): `code`, `severity`, `message`,',
    '  `position` (`{ offset, line, column }`, one-based line and column) and, for problems found',
    '  while decoding bytes, `byteOffset`. They go to the `diagnostics` sink of the options, to',
    '  `ParsedDsl.diagnostics` and `diagnosticCounts()`, and to `DslEntry.diagnostics` for the',
    '  headwords and body of an entry; parsing goes on. With the `strict` option, the first one',
    '  of the strict severity or a more severe one is thrown as a `DslError` with the same `code`',
    '  and the diagnostic in `error.diagnostic`.',
    '- **Thrown** codes are never reported: they only reach you as a `DslError`, from the call,',
    '  the iteration or the promise that failed. Runtime errors are wrapped, with the original',
    '  error as `cause`.',
    '',
    'Severities: `error` (the input is broken and content may be lost), `warning` (the input is',
    'suspect; the result is a best guess) and `info` (a remark; nothing is lost).',
    '',
    '## Compatibility',
    '',
    '- Codes are stable identifiers: a released code keeps its meaning and is never reused. Match',
    '  on `code`.',
    '- New codes are added in minor versions, so expect codes you do not know.',
    '- The default severity of a code is part of the contract (strict mode depends on it): it',
    '  changes only in a major version.',
    '- Messages are not stable: their wording may change in any version. The `name` of a catalog',
    '  entry is informational too.',
    '- Codes of plugins are namespaced by the plugin name, `<plugin-name>/<id>` (see',
    '  `createPluginDiagnostic`); a plugin that gives no code reports `DSL5101`. Plugins choose',
    '  the severity of what they report.',
  ];
  for (const [prefix, title, intro] of RANGES) {
    const rows = specs.filter((spec) => spec.code.startsWith(prefix));
    if (rows.length === 0) continue;
    lines.push('', `## ${title}`, '', intro, '', '| Code | Severity | Delivery | Summary |');
    lines.push('| --- | --- | --- | --- |');
    for (const spec of rows) lines.push(row(spec));
  }
  return `${lines.join('\n')}\n`;
}

function row(spec: DiagnosticSpec): string {
  const delivery = spec.thrown ? 'thrown' : 'reported';
  return `| \`${spec.code}\` | ${spec.severity} | ${delivery} | ${cell(spec.summary)} |`;
}

const ATTRIBUTES: Readonly<Record<NonNullable<TagSpec['attrs']>, string>> = {
  none: '',
  color: 'optional color name: `[c red]`',
  level: 'the level, a digit in the name: `[m2]`',
  lang: '`id=1033` or `name="English"`',
  ref: 'optional `dict="..."`; `target="..."` (undocumented)',
  url: 'optional `target="..."` (undocumented)',
};

function tagName(spec: TagSpec): string {
  return spec.name === 'm' ? '`[m]`, `[m0]`..`[m9]`' : `\`[${spec.name}]\``;
}

/** The table of tags in `docs/dsl-format.md`, from the registry. */
function renderTags(): string {
  const lines = [
    '| Tag | Kind | Closing tag | Attributes | In headwords | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const spec of TAGS) {
    const closing = !spec.paired ? 'none' : spec.closeOptional ? 'optional' : 'required';
    const attrs = ATTRIBUTES[spec.attrs ?? 'none'] + (spec.attrsRequired ? ' (required)' : '');
    const notes = [
      spec.description,
      spec.dialect === 'undocumented' ? 'Undocumented by Lingvo.' : '',
    ].filter((note) => note.length > 0);
    lines.push(
      `| ${tagName(spec)} | ${spec.kind} | ${closing} | ${attrs || '-'} | ${spec.allowedInHeadword ? 'in `{...}`' : '-'} | ${notes.join(' ')} |`,
    );
  }
  return lines.join('\n');
}

/** The dictionary of the AST sample in `docs/ast.md`. */
const AST_SAMPLE = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

{to }walk
\t[m1][p]v[/p] [trn]gehen[/trn]
\tsee <<run>>
\t@ ~ out
\t[m1][trn]hinausgehen[/trn]
\t@
`;

async function renderAstSample(): Promise<string> {
  const [entry] = await collect(parseDsl(AST_SAMPLE, { positions: false }).entries());
  return fence('json', compactJson(entry));
}

/** The JSONL sample of `docs/jsonl.md`: a dictionary in UTF-16LE with a BOM, as most are. */
async function renderJsonlSample(): Promise<string> {
  const { plainText } = await import('../../src/plugins/index.js');
  const text = `${AST_SAMPLE.slice(0, AST_SAMPLE.indexOf('{'))}cat\n\t[m1][trn]Katze[/trn]\ndog\n\t[m1][trn]Hund[/trn] [b]\n`;
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    bytes[2 + 2 * i] = text.charCodeAt(i) & 0xff;
    bytes[3 + 2 * i] = text.charCodeAt(i) >> 8;
  }
  const lines = await collect(toJsonl(parseDsl(bytes), { plugin: plainText, summary: true }));
  return fence(
    'jsonl',
    lines.join('').replaceAll(`"version":"${VERSION}"`, `"version":"${RELEASE}"`),
  );
}

/** Headwords as written, for the table of `docs/ast.md`. */
const HEADWORDS = [
  'colo(u)r(s)',
  '(un)lock(ed)',
  'a(b(c))d',
  '{to }walk',
  "{[']}a{[/']}rt",
  'walk\\ in',
  '\\(not\\) optional',
];

function renderHeadwords(): string {
  const code = (text: string): string => `\`${text.replaceAll('\u00a0', '\\u00a0')}\``;
  const lines = ['| Written | `text` | `variants` |', '| --- | --- | --- |'];
  for (const raw of HEADWORDS) {
    const { text, variants } = parseHeadword(raw, { positions: false });
    lines.push(`| ${code(raw)} | ${code(text)} | ${variants.map(code).join(', ')} |`);
  }
  return lines.join('\n');
}

/** The generated regions, by name. */
export const GENERATED: Readonly<Record<string, () => string | Promise<string>>> = {
  'cli-usage': () => fence('text', USAGE),
  'cli-usage-convert': () => fence('text', CONVERT_USAGE),
  'cli-usage-info': () => fence('text', INFO_USAGE),
  tags: renderTags,
  headwords: renderHeadwords,
  'ast-sample-dsl': () => fence('text', AST_SAMPLE),
  'ast-sample-json': renderAstSample,
  'ast-positions': () =>
    fence('json', compactJson(parseMarkup('[b]walk[/b]', { positions: true }))),
  'jsonl-sample': renderJsonlSample,
};

/**
 * A document with its example blocks and generated regions brought up to date.
 *
 * @param examples - The source of each example, by name.
 */
export async function updateDocument(
  text: string,
  examples: Readonly<Record<string, { readonly language: string; readonly source: string }>>,
): Promise<string> {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    out.push(line);
    const example = /^<!-- example: ([\w.-]+) -->$/.exec(line);
    if (example !== null) {
      const name = example[1] as string;
      const found = examples[name];
      if (found === undefined) throw new Error(`No example ${name} (line ${i + 1})`);
      if (!/^```/.test(lines[i + 1] ?? '')) throw new Error(`No code block after line ${i + 1}`);
      const end = lines.indexOf('```', i + 2);
      out.push(fence(found.language, found.source));
      i = end;
      continue;
    }
    const generated = /^<!-- generated: ([\w.-]+) -->$/.exec(line);
    if (generated !== null) {
      const name = generated[1] as string;
      const render = GENERATED[name];
      if (render === undefined) throw new Error(`No generated region ${name} (line ${i + 1})`);
      const end = lines.indexOf(`<!-- end: ${name} -->`, i + 1);
      if (end === -1) throw new Error(`The region ${name} has no end marker (line ${i + 1})`);
      out.push(await render(), lines[end] as string);
      i = end;
    }
  }
  return out.join('\n');
}
