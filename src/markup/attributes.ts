/**
 * Attribute parsing, driven by the attribute schema of the tag registry.
 *
 * @packageDocumentation
 */

import { isKnownColor } from '../data/colors.js';
import { findLanguageById, resolveLanguageName } from '../data/languages.js';
import { getMarginLevel, type TagSpec } from '../data/tags.js';
import type { DiagnosticName } from '../diagnostics/index.js';
import type { TagAttributes } from './ast.js';

/** Shared by all tags without attributes. Frozen: the AST is read-only. */
export const NO_ATTRIBUTES: TagAttributes = Object.freeze({});

/** Reports an attribute problem of the tag being parsed. */
export type AttributeReporter = (name: DiagnosticName, message: string) => void;

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The field of `TagAttributes` of a key, where its name differs. */
const FIELDS: Readonly<Record<string, keyof TagAttributes>> = {
  id: 'languageId',
  name: 'language',
};

/** Keys accepted by the `key=value` schemas, as written in the markup. */
const KEYS: Readonly<Record<string, readonly string[]>> = {
  lang: ['id', 'name'],
  ref: ['dict', 'target'],
  url: ['target'],
};

/**
 * Parses the attributes of an opening tag.
 *
 * - `level` (`[m]`): the digit of the name, 0 for a bare `[m]`; attribute text is ignored.
 * - `color` (`[c]`): one bare word, kept even if it is not a known color (`DSL4106`).
 * - `lang`, `ref`, `url`: `key=value` pairs separated by spaces; a value is either bare (up to
 *   the next space) or in double quotes, with `\x` escapes resolved. Keys are those of the
 *   schema (`id`/`name`, `dict`/`target`, `target`); the first of repeated keys wins. The
 *   `id` and `name` of `[lang]` are the fields `languageId` and `language`. A
 *   language id or name unknown to Lingvo is kept (`DSL4106`); a name that is not exact but
 *   resolves leniently (`resolveLanguageName`) is kept as written (`DSL4107`, info);
 *   `[lang]` needs an id or a name (`DSL4105`).
 * - `none`, and unknown tags: attribute text is ignored (`DSL4103` for registered tags only).
 *
 * The raw text is always kept in the node (`rawAttrs`), so nothing is lost.
 */
export function parseAttributes(
  spec: TagSpec | undefined,
  name: string,
  raw: string,
  report: AttributeReporter,
): TagAttributes {
  if (spec === undefined) return NO_ATTRIBUTES;
  const schema = spec.attrs ?? 'none';
  switch (schema) {
    case 'none':
      if (raw.length > 0) unexpected(spec, report);
      return NO_ATTRIBUTES;
    case 'level':
      if (raw.length > 0) unexpected(spec, report);
      return { level: getMarginLevel(name) ?? 0 };
    case 'color':
      return parseColor(raw, report);
    case 'lang':
    case 'ref':
    case 'url':
      return parsePairs(spec, raw, report);
  }
}

function unexpected(spec: TagSpec, report: AttributeReporter): void {
  report('unexpectedAttributes', `The [${spec.name}] tag takes no attributes; they are ignored.`);
}

function parseColor(raw: string, report: AttributeReporter): TagAttributes {
  if (raw.length === 0) return NO_ATTRIBUTES;
  if (/[\s="\\]/.test(raw)) {
    report('invalidAttribute', 'The color of [c] must be a single color name; it is ignored.');
    return NO_ATTRIBUTES;
  }
  if (!isKnownColor(raw)) {
    report('unknownAttributeValue', `"${raw}" is not a known color name (names are lowercase).`);
  }
  return { color: raw };
}

const SPACE = /[ \t]/;
const KEY = /[A-Za-z_][\w-]*/y;

function parsePairs(spec: TagSpec, raw: string, report: AttributeReporter): TagAttributes {
  const allowed = KEYS[spec.attrs as string] as readonly string[];
  const attrs: Writable<TagAttributes> = {};
  let written = false;
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && SPACE.test(raw[i] as string)) i++;
    if (i >= raw.length) break;
    KEY.lastIndex = i;
    const key = KEY.exec(raw)?.[0];
    if (key === undefined) {
      report('invalidAttribute', `The attributes of [${spec.name}] are malformed.`);
      break;
    }
    i += key.length;
    written = true;
    while (i < raw.length && SPACE.test(raw[i] as string)) i++;
    if (raw[i] !== '=') {
      report('invalidAttribute', `The attribute ${key} of [${spec.name}] has no value.`);
      break;
    }
    i++;
    while (i < raw.length && SPACE.test(raw[i] as string)) i++;
    const value = readValue(raw, i);
    if (value === undefined) {
      report('invalidAttribute', `The value of ${key} in [${spec.name}] has no closing quote.`);
      break;
    }
    i = value.end;
    setPair(spec, allowed, attrs, key, value.text, report);
  }
  if (spec.attrsRequired && !written) {
    report('missingAttribute', `The [${spec.name}] tag needs an id or a name attribute.`);
  }
  return Object.keys(attrs).length === 0 ? NO_ATTRIBUTES : attrs;
}

/** Reads a bare or quoted value at `i`; `undefined` for an unterminated quote. */
function readValue(raw: string, i: number): { text: string; end: number } | undefined {
  const quoted = raw[i] === '"';
  let j = quoted ? i + 1 : i;
  let text = '';
  while (j < raw.length) {
    const ch = raw[j] as string;
    if (ch === '\\' && j + 1 < raw.length) {
      text += raw[j + 1];
      j += 2;
      continue;
    }
    if (quoted ? ch === '"' : SPACE.test(ch)) break;
    text += ch;
    j++;
  }
  if (quoted) {
    if (j >= raw.length) return undefined;
    j++;
  }
  return { text, end: j };
}

function setPair(
  spec: TagSpec,
  allowed: readonly string[],
  attrs: Writable<TagAttributes>,
  key: string,
  value: string,
  report: AttributeReporter,
): void {
  if (!allowed.includes(key)) {
    report('invalidAttribute', `[${spec.name}] has no attribute ${key}; it is ignored.`);
    return;
  }
  if ((attrs as Record<string, unknown>)[FIELDS[key] ?? key] !== undefined) {
    report(
      'invalidAttribute',
      `The attribute ${key} of [${spec.name}] is repeated; it is ignored.`,
    );
    return;
  }
  switch (key) {
    case 'id': {
      if (!/^[0-9]{1,9}$/.test(value)) {
        report('invalidAttribute', `The language id "${value}" is not a number; it is ignored.`);
        return;
      }
      const id = Number(value);
      if (findLanguageById(id) === undefined) {
        report('unknownAttributeValue', `The language id ${id} is not known to Lingvo.`);
      }
      attrs.languageId = id;
      return;
    }
    case 'name': {
      const match = resolveLanguageName(value);
      if (match === undefined) {
        report(
          'unknownAttributeValue',
          `"${value}" is not a Lingvo language name (names are case-sensitive).`,
        );
      } else if (!match.exact) {
        report(
          'inexactLanguageName',
          `"${value}" is not an exact Lingvo language name; it resolves to ${match.language.name}.`,
        );
      }
      attrs.language = value;
      return;
    }
    case 'dict':
      attrs.dict = value;
      return;
    case 'target':
      attrs.target = value;
      return;
  }
}
