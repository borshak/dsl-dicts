/**
 * The classifier: which shape an entry has, and so which extractor reads it.
 *
 * @packageDocumentation
 */

import type { MarkupNode } from '../index.js';
import type { ExtractionContext } from './context.js';
import { readParagraphs, takeTranscriptions } from './paragraph.js';
import type { ArticleKind } from './types.js';

/**
 * Tells the shape of a body (or a sub-entry's content), that is the name of the extractor
 * to read it with. Must not mutate the body.
 *
 * @experimental
 */
export type Classifier = (body: readonly MarkupNode[], context: ExtractionContext) => ArticleKind;

const ZONES = new Set(['trn', 'trn1', 'ex', 'com']);
const CONTENT_ZONES = new Set(['trn', 'trn1', 'ex']);

/**
 * The built-in classifier. Sub-entries are not looked at (they are classified on their own).
 *
 * 1. `zone-marked` if a translation or example zone (`[trn]`, `[trn1]`, `[ex]`) has text of
 *    its own: letters outside labels and links (a sense number after a link is not).
 * 2. `reference-only` if there are links (`<<...>>`, `[ref]`, `[url]`) and, besides them,
 *    only labels, comments, media, transcriptions, punctuation, numbering and short texts
 *    that label the links (`см.`, `=`) or give their sense (`2)`); `media-only` if the same
 *    holds with media and no links.
 * 3. `zone-marked` if there is any zone (`[com]` alone, or an empty `[trn]`).
 * 4. `layout-only` if there are paragraphs (`[m]`).
 * 5. `plain` otherwise, an empty body included.
 *
 * @experimental
 */
export const classifyBody: Classifier = (body, context) => {
  let content = false;
  let zones = false;
  let margins = false;
  let links = 0;
  let media = 0;
  const visit = (nodes: readonly MarkupNode[], inZone: boolean): void => {
    for (const node of nodes) {
      if (content) return;
      if (node.type === 'text') {
        if (inZone && /\p{L}/u.test(node.text)) content = true;
      } else if (node.type === 'tilde') {
        if (inZone) content = true;
      } else if (node.type === 'link') {
        links++;
      } else if (node.type === 'tag') {
        if (node.name === 'ref' || node.name === 'url') {
          links++;
          continue;
        }
        if (node.name === 's' || node.name === 'video') media++;
        if (node.name === 'm') margins = true;
        if (ZONES.has(node.name)) zones = true;
        // Labels are not content of their own, even in a zone.
        if (node.name !== 'p') visit(node.children, inZone || CONTENT_ZONES.has(node.name));
      }
    }
  };
  visit(body, false);
  if (content) return 'zone-marked';
  if (links > 0 || media > 0) {
    const onlyThat = readParagraphs(body, context, 'zones').every(
      (p) => p.translations.length === 0 && takeTranscriptions(p.notes, []).length === 0,
    );
    if (onlyThat) return links > 0 ? 'reference-only' : 'media-only';
  }
  if (zones) return 'zone-marked';
  return margins ? 'layout-only' : 'plain';
};
