/**
 * Text helpers of the article plugin: whitespace, punctuation, brackets, numbering.
 *
 * @packageDocumentation
 */

import type { Media } from './types.js';

/** Collapses runs of whitespace to one space and trims. U+00A0 is kept inside the text. */
export function collapse(text: string): string {
  return text.replace(/[ \t\r\n]+/g, ' ').trim();
}

/** Tells whether a text has no letter and no digit: punctuation, bullets, whitespace. */
export function isTrivial(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** Removes separators (whitespace, commas, semicolons) from both ends. */
export function trimSeparators(text: string): string {
  return text.replace(/^[\s,;]+|[\s,;]+$/g, '');
}

const OPENING = '([{«';
const CLOSING = ')]}»';

/** Splits a text at a separator character outside brackets. */
export function splitOutsideBrackets(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (OPENING.includes(char)) depth++;
    else if (CLOSING.includes(char)) depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Removes one pair of parentheses that encloses the whole text: `(a, b)` is `a, b`. */
export function stripEnclosingParentheses(text: string): string {
  if (!text.startsWith('(') || !text.endsWith(')')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      // The first parenthesis closes before the end: `(a) b (c)`.
      if (depth === 0 && i < text.length - 1) return text;
    }
  }
  return depth === 0 ? text.slice(1, -1).trim() : text;
}

/** Numbering styles, outermost first: their rank orders the levels of the sense tree. */
export type MarkerStyle = 'roman' | 'arabic.' | 'arabic)' | 'letter';

/** Rank of each numbering style: a sense contains senses of a higher rank. */
export const MARKER_RANK: Readonly<Record<MarkerStyle, number>> = {
  roman: 0,
  'arabic.': 1,
  'arabic)': 2,
  letter: 3,
};

/** A numbering marker at the start of a paragraph. */
export interface Marker {
  readonly style: MarkerStyle;
  /** The number or letter, without punctuation. */
  readonly value: string;
  /** How many characters of the text it takes, the following whitespace included. */
  readonly length: number;
}

const ROMAN = /^(?=[IVXLC])C{0,3}(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

/**
 * Finds a numbering marker at the start of a paragraph's first text: `1.`, `1)`, `а)` (one
 * lowercase letter, any script), or a roman numeral `I`, `IV.` (homonyms), which must be
 * followed by `.` or `)` or be bold: a bare `I` is too often a word.
 */
export function findMarker(text: string, bold: boolean): Marker | undefined {
  const lead = /^\s*/.exec(text)?.[0].length ?? 0;
  const rest = text.slice(lead);
  let match = /^(\d{1,3})([.)])(?=\s|$)/.exec(rest);
  if (match !== null) {
    const [all, value = '', punctuation] = match;
    return marker(punctuation === '.' ? 'arabic.' : 'arabic)', value, lead + all.length, text);
  }
  match = /^(\p{Ll})\)(?=\s|$)/u.exec(rest);
  if (match !== null) return marker('letter', match[1] ?? '', lead + match[0].length, text);
  match = /^([IVXLC]+)([.)]?)(?=\s|$)/.exec(rest);
  if (match !== null && ROMAN.test(match[1] ?? '') && (bold || match[2] !== '')) {
    return marker('roman', match[1] ?? '', lead + match[0].length, text);
  }
  return undefined;
}

function marker(style: MarkerStyle, value: string, end: number, text: string): Marker {
  const space = /^\s*/.exec(text.slice(end))?.[0].length ?? 0;
  return { style, value, length: end + space };
}

/**
 * A text that only gives the sense of a link target: a number, or a list of numbers (`2`,
 * `1)`, `2. 3)`, `II`).
 */
export function isSenseNumber(text: string): boolean {
  return /^(?:(?:\d{1,3}|[IVX]{1,4}|\p{Ll})[.)]?)(?:[\s,]+(?:\d{1,3}|[IVX]{1,4}|\p{Ll})[.)]?)*$/u.test(
    text,
  );
}

/** A short text that can label the link after it: at most three words and 25 characters. */
export function isLinkPrefix(text: string): boolean {
  return text.length <= 25 && text.split(' ').length <= 3;
}

/** A heading of a list, such as `Syn:`: a short text ending with a colon. */
export function headingText(text: string): string | undefined {
  if (!text.endsWith(':') || text.length > 30 || text.split(' ').length > 3) return undefined;
  const heading = text.slice(0, -1).trim();
  return heading.length === 0 ? undefined : heading;
}

/** Transcriptions written in brackets: `[ˈkʌlə]`, `[a], [b]`; `undefined` if not only that. */
export function bracketedTranscriptions(text: string): string[] | undefined {
  if (!/^\[[^[\]]+\](?:\s*[,;/]?\s*\[[^[\]]+\])*$/.test(text)) return undefined;
  return [...text.matchAll(/\[([^[\]]+)\]/g)].map((m) => (m[1] ?? '').trim());
}

const SOUND = new Set([
  'wav',
  'mp3',
  'ogg',
  'oga',
  'opus',
  'spx',
  'flac',
  'm4a',
  'aac',
  'wma',
  'aif',
  'aiff',
  'mid',
  'midi',
]);
const IMAGE = new Set([
  'bmp',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'tif',
  'tiff',
  'webp',
  'svg',
  'ico',
  'dib',
  'wmf',
  'emf',
]);
const VIDEO = new Set([
  'avi',
  'mp4',
  'm4v',
  'mpg',
  'mpeg',
  'mkv',
  'webm',
  'mov',
  'wmv',
  'ogv',
  'flv',
  '3gp',
]);

/** The type of a media file, by its extension (case-insensitive). */
export function mediaType(file: string, tag: string): Media['type'] {
  const extension = /\.([^./\\]+)$/.exec(file.trim())?.[1]?.toLowerCase() ?? '';
  if (SOUND.has(extension)) return 'sound';
  if (IMAGE.has(extension)) return 'image';
  if (VIDEO.has(extension) || tag === 'video') return 'video';
  return 'other';
}
