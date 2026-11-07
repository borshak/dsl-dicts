/**
 * Tree builder: a pushdown automaton that turns tokens into the markup AST, driven by the tag
 * registry, with documented recovery rules for malformed markup.
 *
 * Internal; see `parseMarkup` and `parseBody` for the public API.
 *
 * @packageDocumentation
 */

import { getTagSpec, type TagSpec } from '../data/tags.js';
import {
  createDiagnostic,
  type DiagnosticName,
  type DiagnosticSink,
  type SourcePosition,
} from '../diagnostics/index.js';
import { positionInLine, type RawLine } from '../segment/index.js';
import type {
  Headword,
  LineBreakNode,
  LinkNode,
  MarkupNode,
  SubentryNode,
  TagAttributes,
  TagNode,
  TextNode,
  TildeNode,
} from './ast.js';
import { parseAttributes } from './attributes.js';
import type { Token } from './tokenizer.js';

/** Maximum number of nested tags and links; deeper opening tags are kept as text. */
export const MAX_DEPTH = 64;

type Writable<T> = { -readonly [K in keyof T]: T[K] };
type Parent = { children: MarkupNode[]; end?: SourcePosition };

const F_CONTAINER = 0;
const F_TAG = 1;
const F_LINK = 2;

/** An open element: the body, a sub-entry, a tag or a link. */
interface Frame {
  readonly kind: typeof F_CONTAINER | typeof F_TAG | typeof F_LINK;
  readonly node: Parent;
  /** Registry name of a tag (`m` for `m0`..`m9`), or the name as written if unknown. */
  readonly name: string;
  readonly spec: TagSpec | undefined;
  /** Content is plain text: `noNestedTags` tags and links. */
  readonly plain: boolean;
  /** Reopened after an implicit close; removed again if it stays empty. */
  readonly synthetic: boolean;
  /** Line and index of the original opening tag, for diagnostics. */
  readonly line: number;
  readonly at: number;
}

/** Options of the builder. */
export interface BuildOptions {
  readonly positions: boolean;
  readonly diagnostics: DiagnosticSink | undefined;
  /** Parses the headword line of a sub-entry. */
  readonly headword: (line: RawLine) => Headword;
}

/**
 * Builds the AST from tokens.
 *
 * Recovery rules, in the order they are checked (each has a test fixture):
 * 1. Text-only content. Inside `[t]`, `[s]`, `[video]`, `[ref]`, `[url]` (registry
 *    `noNestedTags`) and `<<>>` links, every tag and link is literal text (`DSL4205`), except
 *    the matching closing tag and tags whose registry `parents` name the enclosing tag
 *    (`[preview]` inside `[s]`). `~` stays a `tilde` node.
 * 2. Unknown names. An unknown opening tag is a `tag` node (`DSL4101`) if a closing tag of the
 *    same name follows somewhere in the input, else literal text (`DSL4102`). An unknown
 *    closing tag without an open tag is literal text (`DSL4102`).
 * 3. Depth. More than {@link MAX_DEPTH} nested tags and links: the opening tag is literal
 *    text (`DSL4207`).
 * 4. Margins. `[m]` and `[m0]`..`[m9]` are block-level and their closing tag is optional:
 *    opening one closes every tag open in the current body or sub-entry, the previous `[m]`
 *    included, opens the new one directly in the body or sub-entry, and reopens the closed
 *    tags other than `[m]` inside it (as GoldenDict does): `[m1][*]a[m2]b[/*]` is
 *    `m1(*(a)) m2(*(b))`, with no diagnostic. Closed tags that are still empty, and a line
 *    break right before the margin, are removed. `[/m]` (and `[/m3]`) closes the open margin,
 *    whatever its level. An open `[m]` at the end is normal.
 * 5. Crossed nesting. A closing tag whose tag is open but not innermost closes the tags above
 *    it, closes it, and reopens the tags above (`DSL4203`, info: common and harmless), as
 *    GoldenDict does: `[b][i]x[/b]y[/i]` is `b(i(x)) i(y)`. A reopened tag that stays empty
 *    is removed; tags are not reopened inside text-only content (rule 1).
 * 6. Stray closing tags. A closing tag of a registered name that matches no open tag of the
 *    current body or sub-entry is ignored (`DSL4201`). Tags of the parent body cannot be
 *    closed from inside a sub-entry.
 * 7. Same tag nested. A tag opened inside a tag of the same name is nested (`DSL4204`).
 * 8. Parents. A tag with registry `parents` outside them is kept, with `DSL4206`.
 * 9. End of input, of a sub-entry. Tags still open are closed; `DSL4202` for each, except
 *    `[m]`. A sub-entry cannot be inside a text-only tag: such tags are closed first
 *    (`DSL4202`).
 *
 * Line breaks: a `newline` token makes a pending break, emitted as a `lineBreak` node right
 * before the next content (text, tilde, link or opening tag), inside the tags open at that
 * point. It is dropped by an `[m]` tag, by a sub-entry boundary and at the end, and there is
 * none before the first content of the body or of a sub-entry.
 */
export class TreeBuilder {
  private readonly root: Parent = { children: [] };
  private readonly stack: Frame[];
  /** Index of the innermost container frame. */
  private base = 0;
  /** Number of open tags and links. */
  private depth = 0;
  private pendingBreak = false;
  /** Line of the content after the pending break. */
  private breakLine = 0;
  /** Content was emitted since the start of the current container. */
  private content = false;
  /** Names of closing tags, with the index of their last token; built on demand. */
  private closings: Map<string, number> | undefined;
  /** Current token, for positions of implicit closes. */
  private current = 0;

  constructor(
    private readonly lines: readonly RawLine[],
    private readonly tokens: readonly Token[],
    private readonly options: BuildOptions,
  ) {
    this.stack = [this.frame(F_CONTAINER, this.root, '', undefined, false, false, 0, 0)];
  }

  /** Runs the automaton over all tokens and returns the top-level nodes. */
  build(): MarkupNode[] {
    const tokens = this.tokens;
    for (let i = 0; i < tokens.length; i++) {
      this.current = i;
      const t = tokens[i] as Token;
      switch (t.kind) {
        case 'text':
        case 'punct':
          this.text(t.value, t);
          break;
        case 'tilde':
          this.tilde(t);
          break;
        case 'open':
          this.open(t, i);
          break;
        case 'close':
          this.close(t);
          break;
        case 'linkOpen':
          this.linkOpen(t);
          break;
        case 'linkClose':
          this.linkClose(t);
          break;
        case 'newline':
          if (this.content) {
            this.pendingBreak = true;
            this.breakLine = t.line;
          }
          break;
        case 'subentryOpen':
          this.subentryOpen(t);
          break;
        case 'subentryHeadword': {
          const frame = this.stack[this.base] as Frame;
          if (frame.node !== this.root) {
            ((frame.node as unknown as SubentryNode).headwords as Headword[]).push(
              this.options.headword(t.headword as RawLine),
            );
          }
          break;
        }
        case 'subentryClose':
          this.subentryClose(t);
          break;
      }
    }
    this.current = tokens.length;
    while (this.stack.length > 1) {
      if (this.top.kind === F_CONTAINER) this.popContainer(this.endOfLast());
      else this.closeUnclosed(this.endOfLast());
    }
    return this.root.children;
  }

  private get top(): Frame {
    return this.stack[this.stack.length - 1] as Frame;
  }

  private frame(
    kind: Frame['kind'],
    node: Parent,
    name: string,
    spec: TagSpec | undefined,
    plain: boolean,
    synthetic: boolean,
    line: number,
    at: number,
  ): Frame {
    return { kind, node, name, spec, plain, synthetic, line, at };
  }

  // Positions.

  private pos(line: number, index: number): SourcePosition {
    return positionInLine(this.lines[line] as RawLine, index);
  }

  private startOf(t: Token): SourcePosition {
    return this.pos(t.line, t.start);
  }

  private endOf(t: Token): SourcePosition {
    return this.pos(t.line, t.end);
  }

  /** End of the last content token, for implicit closes at the end of input. */
  private endOfLast(): SourcePosition | undefined {
    if (!this.options.positions) return undefined;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i] as Token;
      if (t.kind !== 'newline') return this.endOf(t);
    }
    const first = this.lines[0];
    return first === undefined ? undefined : first.position;
  }

  /** Start of the current token, for implicit closes caused by it. */
  private here(): SourcePosition | undefined {
    if (!this.options.positions) return undefined;
    const t = this.tokens[this.current];
    return t === undefined ? this.endOfLast() : this.startOf(t);
  }

  private report(name: DiagnosticName, message: string, line: number, at: number): void {
    const sink = this.options.diagnostics;
    if (sink === undefined) return;
    sink.report(createDiagnostic(name, message, { position: this.pos(line, at) }));
  }

  // Content.

  private append(node: MarkupNode): void {
    this.top.node.children.push(node);
  }

  /** Emits the pending line break, before new content. */
  private beforeContent(): void {
    this.content = true;
    if (!this.pendingBreak) return;
    this.pendingBreak = false;
    if (this.options.positions) {
      // From the end of the previous line to the start of the next, unless closing tags at
      // the start of the next line come first: then it is empty, right before the content.
      const prev = this.lines[this.breakLine - 1] as RawLine;
      let position = positionInLine(prev, prev.text.length);
      let end = (this.lines[this.breakLine] as RawLine).position;
      const parent = this.top.node as Parent & { position?: SourcePosition };
      const last = parent.children[parent.children.length - 1];
      const bound = Math.max(last?.end?.offset ?? -1, parent.position?.offset ?? -1);
      if (bound > position.offset) {
        position = this.here() as SourcePosition;
        end = position;
      }
      this.append({ type: 'lineBreak', origin: 'line', position, end });
    } else {
      this.append({ type: 'lineBreak', origin: 'line' });
    }
  }

  private text(value: string, t: Token): void {
    this.beforeContent();
    const children = this.top.node.children;
    const last = children[children.length - 1];
    if (last !== undefined && last.type === 'text') {
      const node = last as Writable<TextNode>;
      node.text += value;
      if (this.options.positions) node.end = this.endOf(t);
      return;
    }
    const node: TextNode = this.options.positions
      ? { type: 'text', text: value, position: this.startOf(t), end: this.endOf(t) }
      : { type: 'text', text: value };
    children.push(node);
  }

  /** Keeps a token as text, as written. */
  private literal(t: Token): void {
    const line = this.lines[t.line] as RawLine;
    this.text(line.text.slice(t.start, t.end), t);
  }

  private tilde(t: Token): void {
    this.beforeContent();
    const node: TildeNode = this.options.positions
      ? { type: 'tilde', flipCase: t.flip, position: this.startOf(t), end: this.endOf(t) }
      : { type: 'tilde', flipCase: t.flip };
    this.append(node);
  }

  // Tags.

  private open(t: Token, index: number): void {
    const written = t.value;
    const spec = getTagSpec(written);
    const top = this.top;
    if (top.plain && !(spec?.parents?.includes(top.name) ?? false)) {
      this.report(
        'tagInPlainText',
        `[${written}] inside ${describe(top)} is kept as text.`,
        t.line,
        t.start,
      );
      this.literal(t);
      return;
    }
    if (spec === undefined) {
      if (!this.hasClosingAfter(written, index)) {
        this.report(
          'unknownTagAsText',
          `[${written}] is not a known tag and is not closed; it is kept as text.`,
          t.line,
          t.start,
        );
        this.literal(t);
        return;
      }
      this.report('unknownTag', unknownMessage(written), t.line, t.start);
    }
    if (spec?.name === 'br') {
      if (t.attrs.length > 0) {
        this.report('unexpectedAttributes', 'The [br] tag takes no attributes.', t.line, t.start);
      }
      this.beforeContent();
      const node: LineBreakNode = this.options.positions
        ? { type: 'lineBreak', origin: 'tag', position: this.startOf(t), end: this.endOf(t) }
        : { type: 'lineBreak', origin: 'tag' };
      this.append(node);
      return;
    }
    if (this.depth >= MAX_DEPTH) {
      this.report(
        'nestingTooDeep',
        `[${written}] is nested too deep; it is kept as text.`,
        t.line,
        t.start,
      );
      this.literal(t);
      return;
    }
    const attrs = parseAttributes(spec, written, t.attrs, (name, message) =>
      this.report(name, message, t.line, t.start),
    );
    const name = spec === undefined ? written : spec.name;
    if (name === 'm') {
      this.openMargin(t, spec as TagSpec, attrs);
      return;
    }
    this.beforeContent();
    for (let i = this.stack.length - 1; i > this.base; i--) {
      if ((this.stack[i] as Frame).name === name) {
        this.report(
          'nestedSameTag',
          `[${written}] is opened inside another [${name}].`,
          t.line,
          t.start,
        );
        break;
      }
    }
    if (spec?.parents !== undefined && !(top.kind === F_TAG && spec.parents.includes(top.name))) {
      this.report(
        'misplacedTag',
        `[${name}] is only valid inside ${spec.parents.map((p) => `[${p}]`).join(' or ')}.`,
        t.line,
        t.start,
      );
    }
    this.push(t, name, spec, attrs);
  }

  /** Opens a tag node for token `t` in the current element. */
  private push(t: Token, name: string, spec: TagSpec | undefined, attrs: TagAttributes): void {
    const node = this.tagNode(name, attrs, t.attrs, t.start, t);
    this.append(node as TagNode);
    this.stack.push(
      this.frame(F_TAG, node, name, spec, spec?.noNestedTags === true, false, t.line, t.start),
    );
    this.depth++;
  }

  private tagNode(
    name: string,
    attrs: TagAttributes,
    rawAttrs: string,
    at: number,
    t: Token,
  ): Writable<TagNode> & Parent {
    const node: Writable<TagNode> & Parent =
      rawAttrs.length > 0
        ? { type: 'tag', name, attrs, rawAttrs, children: [] }
        : { type: 'tag', name, attrs, children: [] };
    if (this.options.positions) node.position = this.pos(t.line, at);
    return node;
  }

  /** Rule 4: an `[m]` tag. */
  private openMargin(t: Token, spec: TagSpec, attrs: TagAttributes): void {
    this.pendingBreak = false;
    this.content = true;
    const reopen: Frame[] = [];
    const at = this.here();
    // Tags that are still empty move into the margin: they are removed here. So is a line
    // break that ends up right before the margin, which starts a new line by itself.
    while (this.stack.length - 1 > this.base) {
      const frame = this.pop(at, true);
      if (frame.name !== 'm') reopen.push(frame);
    }
    dropTrailingBreak(this.top.node);
    this.push(t, 'm', spec, attrs);
    this.reopen(reopen, t);
  }

  /**
   * Reopens closed frames (given innermost first) as synthetic tags after token `t`, except
   * where rule 1 forbids tags.
   */
  private reopen(frames: readonly Frame[], t: Token): void {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i] as Frame;
      // Rule 1 holds for reopened tags too: they stay closed inside text-only content.
      const top = this.top;
      if (top.plain && !(frame.spec?.parents?.includes(top.name) ?? false)) continue;
      const old = frame.node as unknown as TagNode;
      const node = this.tagNode(frame.name, old.attrs, old.rawAttrs ?? '', t.end, t);
      this.append(node as TagNode);
      this.stack.push({ ...frame, node, synthetic: true });
      this.depth++;
    }
  }

  private close(t: Token): void {
    const written = t.value;
    const spec = getTagSpec(written);
    const name = spec === undefined ? written : spec.name;
    const top = this.top;
    if (top.plain) {
      if (top.kind === F_TAG && top.name === name) {
        this.pop(this.endOf0(t));
      } else {
        this.report(
          'tagInPlainText',
          `[/${written}] inside ${describe(top)} is kept as text.`,
          t.line,
          t.start,
        );
        this.literal(t);
      }
      return;
    }
    let j = this.stack.length - 1;
    while (j > this.base && (this.stack[j] as Frame).name !== name) j--;
    if (j === this.base || (this.stack[j] as Frame).kind !== F_TAG) {
      if (spec === undefined) {
        this.report(
          'unknownTagAsText',
          `[/${written}] closes no open tag and is not a known tag; it is kept as text.`,
          t.line,
          t.start,
        );
        this.literal(t);
      } else {
        this.report(
          'strayClosingTag',
          `[/${written}] closes no open tag; it is ignored.`,
          t.line,
          t.start,
        );
      }
      return;
    }
    if (t.attrs.length > 0) {
      this.report(
        'unexpectedAttributes',
        `The closing tag [/${written}] has attributes; they are ignored.`,
        t.line,
        t.start,
      );
    }
    if (j === this.stack.length - 1) {
      this.pop(this.endOf0(t));
      return;
    }
    this.report(
      'crossedTags',
      `[/${written}] closes [${name}] while ${describe(this.top)} inside it is open; the inner tags are reopened.`,
      t.line,
      t.start,
    );
    const at = this.here();
    const reopen: Frame[] = [];
    while (this.stack.length - 1 > j) reopen.push(this.pop(at));
    this.pop(this.endOf0(t));
    this.reopen(reopen, t);
  }

  private endOf0(t: Token): SourcePosition | undefined {
    return this.options.positions ? this.endOf(t) : undefined;
  }

  /**
   * Pops the innermost frame; `end` is where it ends. An empty synthetic tag is removed from
   * its parent, and so is any empty tag with `dropEmpty`.
   */
  private pop(end: SourcePosition | undefined, dropEmpty = false): Frame {
    const frame = this.stack.pop() as Frame;
    if (frame.kind !== F_CONTAINER) this.depth--;
    if (dropEmpty) dropTrailingBreak(frame.node);
    if ((dropEmpty || frame.synthetic) && frame.node.children.length === 0) {
      this.top.node.children.pop();
    } else if (end !== undefined) {
      frame.node.end = end;
    }
    return frame;
  }

  /** Rule 9: pops an open tag or link at the end of its container. */
  private closeUnclosed(end: SourcePosition | undefined): void {
    const frame = this.top;
    if (frame.name !== 'm' && frame.kind === F_TAG) {
      this.report(
        'unclosedTag',
        `[${frame.name}] is not closed; it is closed at the end of the ${this.base === 0 ? 'text' : 'sub-entry'}.`,
        frame.line,
        frame.at,
      );
    }
    this.pop(end);
  }

  /** Looks for a closing tag named `name` after token `index`. */
  private hasClosingAfter(name: string, index: number): boolean {
    if (this.closings === undefined) {
      this.closings = new Map();
      for (let i = 0; i < this.tokens.length; i++) {
        const t = this.tokens[i] as Token;
        if (t.kind === 'close') this.closings.set(t.value, i);
      }
    }
    return (this.closings.get(name) ?? -1) > index;
  }

  // Links.

  private linkOpen(t: Token): void {
    const top = this.top;
    if (top.plain || this.depth >= MAX_DEPTH) {
      if (top.plain) {
        this.report(
          'tagInPlainText',
          `A << link inside ${describe(top)} is kept as text.`,
          t.line,
          t.start,
        );
      } else {
        this.report(
          'nestingTooDeep',
          'The << link is nested too deep; it is kept as text.',
          t.line,
          t.start,
        );
      }
      this.literal(t);
      return;
    }
    this.beforeContent();
    const node: Writable<LinkNode> & Parent = this.options.positions
      ? { type: 'link', children: [], position: this.startOf(t) }
      : { type: 'link', children: [] };
    this.append(node as LinkNode);
    this.stack.push(this.frame(F_LINK, node, '', undefined, true, false, t.line, t.start));
    this.depth++;
  }

  private linkClose(t: Token): void {
    if (this.top.kind === F_LINK) this.pop(this.endOf0(t));
    else this.literal(t);
  }

  // Sub-entries.

  private subentryOpen(t: Token): void {
    const at = this.here();
    // A sub-entry cannot be inside text-only content: close the outermost text-only tag.
    let plain = -1;
    for (let i = this.stack.length - 1; i > this.base; i--) {
      if ((this.stack[i] as Frame).plain) plain = i;
    }
    if (plain !== -1) while (this.stack.length > plain) this.closeUnclosed(at);
    this.pendingBreak = false;
    const headwords = [this.options.headword(t.headword as RawLine)];
    const node: Writable<SubentryNode> & Parent = this.options.positions
      ? { type: 'subentry', headwords, children: [], position: this.startOf(t) }
      : { type: 'subentry', headwords, children: [] };
    this.append(node as SubentryNode);
    this.stack.push(this.frame(F_CONTAINER, node, '', undefined, false, false, t.line, t.start));
    this.base = this.stack.length - 1;
    this.content = false;
  }

  private subentryClose(t: Token): void {
    if (this.base === 0) return;
    const at = this.here();
    while (this.stack.length - 1 > this.base) this.closeUnclosed(at);
    this.popContainer(this.endOf0(t));
  }

  private popContainer(end: SourcePosition | undefined): void {
    this.pop(end);
    let base = this.stack.length - 1;
    while ((this.stack[base] as Frame).kind !== F_CONTAINER) base--;
    this.base = base;
    this.pendingBreak = false;
    this.content = false;
  }
}

/** Removes a line break between lines from the end of a node's children. */
function dropTrailingBreak(node: Parent): void {
  const last = node.children[node.children.length - 1];
  if (last !== undefined && last.type === 'lineBreak' && last.origin === 'line') {
    node.children.pop();
  }
}

function describe(frame: Frame): string {
  return frame.kind === F_LINK ? 'a << link' : `[${frame.name}]`;
}

function unknownMessage(name: string): string {
  const lower = name.toLowerCase();
  const hint =
    lower !== name && getTagSpec(lower) !== undefined
      ? ` Tag names are lowercase: [${lower}]?`
      : '';
  return `[${name}] is not a known tag; it is kept because it is closed later.${hint}`;
}
