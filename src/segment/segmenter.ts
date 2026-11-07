/**
 * Synchronous push segmenter: newline-normalized text in, header and raw entries out.
 *
 * @packageDocumentation
 */

import {
  createDiagnostic,
  type Diagnostic,
  type DiagnosticSink,
  dslError,
  type SourcePosition,
} from '../diagnostics/index.js';
import { HeaderBuilder, isDslSpace, trimDslSpace } from './header.js';
import { LineReader, type LogicalLine } from './lines.js';
import type { BodyLine, DslHeader, LineSegment, RawEntry, RawLine } from './types.js';

/** Options of {@link createSegmenter}. Internal. */
export interface SegmenterOptions {
  /**
   * Receives diagnostics as they are found. For strict mode, pass a sink made with
   * `createStrictSink`: its exception propagates out of `push` or `end`.
   */
  readonly diagnostics?: DiagnosticSink;
}

/**
 * Synchronous segmentation engine. Feed it text chunks, split anywhere, with `push`; call
 * `end` once at the end of input. Both return the entries completed so far, in order: an entry
 * is complete when the next headword or the end of input is seen. Internal.
 */
export interface Segmenter {
  /** Feeds the next chunk of text. */
  push(text: string): RawEntry[];
  /** Ends the input and returns the remaining entries. Call it once; `push` is then invalid. */
  end(): RawEntry[];
  /** The header, once the preamble is over (at the first entry line or the end of input). */
  readonly header: DslHeader | undefined;
}

/**
 * Line classes, the events of the state machine. Lines that held nothing but comments and
 * spaces are dropped before classification: they are invisible to the machine.
 */
type LineEvent =
  /** Starts with `#`. */
  | 'directive'
  /** Empty, or spaces and tabs only. */
  | 'blank'
  /** Starts with any other character. */
  | 'headword'
  /** Starts with a space or tab and has other characters. */
  | 'indented'
  /** End of input. */
  | 'end';

/**
 * States of the segmenter.
 *
 * - `preamble`: the header, `#` lines and blank lines at the start.
 * - `betweenEntries`: no entry is open yet (only before the first headword).
 * - `headwords` / `headwordsGap`: an entry is open and has headwords only; in the gap state a
 *   blank line was seen after them.
 * - `body` / `bodyGap`: the entry has body lines; in the gap state a blank line followed them.
 */
type State = 'preamble' | 'betweenEntries' | 'headwords' | 'headwordsGap' | 'body' | 'bodyGap';

type Action =
  /** Adds a header directive. */
  | 'directive'
  /** Ends the preamble: builds the header. */
  | 'endPreamble'
  /** Reports a `#` line after the header (`DSL2006`); the line is ignored. */
  | 'misplacedDirective'
  /** Reports an indented line without an entry (`DSL2201`); the line is ignored. */
  | 'orphanBody'
  /** Remembers where a run of blank lines starts. */
  | 'noteBlank'
  /** Reports blank lines in the headword block (`DSL2202`). */
  | 'blankAfterHeadword'
  /** Reports blank lines inside a body (`DSL2203`). */
  | 'blankInBody'
  /** Emits the open entry. */
  | 'emit'
  /** Reports the open entry's missing body (`DSL2204`). */
  | 'missingBody'
  /** Opens an entry with the line as its first headword. */
  | 'startEntry'
  /** Adds the line as a headword. */
  | 'addHeadword'
  /** Adds the line to the body. */
  | 'addBody';

type Transition = readonly [next: State, ...actions: Action[]];

/** The state machine. Every state handles every event, which the types enforce. */
const TRANSITIONS: Readonly<Record<State, Readonly<Record<LineEvent, Transition>>>> = {
  preamble: {
    directive: ['preamble', 'directive'],
    blank: ['preamble'],
    headword: ['headwords', 'endPreamble', 'startEntry'],
    indented: ['betweenEntries', 'endPreamble', 'orphanBody'],
    end: ['preamble', 'endPreamble'],
  },
  betweenEntries: {
    directive: ['betweenEntries', 'misplacedDirective'],
    blank: ['betweenEntries'],
    headword: ['headwords', 'startEntry'],
    indented: ['betweenEntries', 'orphanBody'],
    end: ['betweenEntries'],
  },
  headwords: {
    directive: ['headwords', 'misplacedDirective'],
    blank: ['headwordsGap', 'noteBlank'],
    headword: ['headwords', 'addHeadword'],
    indented: ['body', 'addBody'],
    end: ['betweenEntries', 'missingBody', 'emit'],
  },
  headwordsGap: {
    directive: ['headwordsGap', 'misplacedDirective'],
    blank: ['headwordsGap'],
    headword: ['headwords', 'blankAfterHeadword', 'addHeadword'],
    indented: ['body', 'blankAfterHeadword', 'addBody'],
    end: ['betweenEntries', 'missingBody', 'emit'],
  },
  body: {
    directive: ['body', 'misplacedDirective'],
    blank: ['bodyGap', 'noteBlank'],
    headword: ['headwords', 'emit', 'startEntry'],
    indented: ['body', 'addBody'],
    end: ['betweenEntries', 'emit'],
  },
  bodyGap: {
    directive: ['bodyGap', 'misplacedDirective'],
    blank: ['bodyGap'],
    headword: ['headwords', 'emit', 'startEntry'],
    indented: ['body', 'blankInBody', 'addBody'],
    end: ['betweenEntries', 'emit'],
  },
};

/** An entry under construction, with the sub-entry pairing state. */
interface OpenEntry {
  readonly headwords: RawLine[];
  readonly body: BodyLine[];
  readonly position: SourcePosition;
  end: SourcePosition;
  /** First start line of the open sub-entry, if any. */
  subentry: BodyLine | undefined;
  /** Lines in the open sub-entry after its start lines. */
  subentryLines: number;
}

/** Closing tags only: `[/m]`, `[/c] [/m]`. */
const CLOSING_TAGS = /^(?:[ \t]*\[\/[^\]]*\])*[ \t]*$/;

class SegmenterImpl implements Segmenter {
  header: DslHeader | undefined;
  private state: State = 'preamble';
  private readonly reader: LineReader;
  private readonly headerBuilder: HeaderBuilder;
  private readonly report: (diagnostic: Diagnostic) => void;
  private output: RawEntry[] = [];
  private entry: OpenEntry | undefined;
  private blankStart: SourcePosition | undefined;
  private ended = false;

  constructor(options: SegmenterOptions, stripBom: boolean) {
    const sink = options.diagnostics;
    this.report = sink === undefined ? () => {} : (diagnostic) => sink.report(diagnostic);
    this.headerBuilder = new HeaderBuilder(this.report);
    this.reader = new LineReader((line) => this.line(line), this.report, stripBom);
  }

  push(text: string): RawEntry[] {
    if (this.ended) throw dslError('invalidArgument', 'push() was called after end().');
    this.reader.push(text);
    return this.take();
  }

  end(): RawEntry[] {
    if (this.ended) return [];
    this.ended = true;
    this.reader.end();
    this.dispatch('end', undefined);
    return this.take();
  }

  private take(): RawEntry[] {
    const output = this.output;
    if (output.length > 0) this.output = [];
    return output;
  }

  private line(line: LogicalLine): void {
    const event = classify(line);
    if (event !== undefined) this.dispatch(event, line);
  }

  private dispatch(event: LineEvent, line: LogicalLine | undefined): void {
    const [next, ...actions] = TRANSITIONS[this.state][event];
    for (const action of actions) this.run(action, line as LogicalLine);
    this.state = next;
  }

  /** Runs an action. `line` is undefined only for the `end` event, whose actions ignore it. */
  private run(action: Action, line: LogicalLine): void {
    switch (action) {
      case 'directive':
        this.headerBuilder.add(line.text, line.position);
        return;
      case 'endPreamble':
        this.header = this.headerBuilder.build();
        return;
      case 'misplacedDirective':
        this.report(
          createDiagnostic(
            'misplacedDirective',
            'A line starting with # after the header is ignored.',
            { position: line.position },
          ),
        );
        return;
      case 'orphanBody':
        this.report(
          createDiagnostic('orphanBodyLine', 'An indented line without a headword is ignored.', {
            position: line.position,
          }),
        );
        return;
      case 'noteBlank':
        this.blankStart = line.position;
        return;
      case 'blankAfterHeadword':
        this.report(
          createDiagnostic('blankLineAfterHeadword', 'Blank lines after a headword are skipped.', {
            position: this.blankStart,
          }),
        );
        return;
      case 'blankInBody':
        this.report(
          createDiagnostic('blankLineInBody', 'Blank lines inside a body are skipped.', {
            position: this.blankStart,
          }),
        );
        return;
      case 'emit':
        this.emit();
        return;
      case 'missingBody': {
        const entry = this.entry as OpenEntry;
        this.report(
          createDiagnostic('missingBody', 'The input ends after headwords without a body.', {
            position: entry.headwords[entry.headwords.length - 1]?.position,
          }),
        );
        return;
      }
      case 'startEntry':
        this.entry = {
          headwords: [rawLine(line)],
          body: [],
          position: line.position,
          end: line.end,
          subentry: undefined,
          subentryLines: 0,
        };
        return;
      case 'addHeadword': {
        const entry = this.entry as OpenEntry;
        entry.headwords.push(rawLine(line));
        entry.end = line.end;
        return;
      }
      case 'addBody':
        this.addBody(line);
        return;
      default:
        unreachable(action);
    }
  }

  private addBody(line: LogicalLine): void {
    const entry = this.entry as OpenEntry;
    const body = bodyLine(line);
    entry.body.push(body);
    entry.end = line.end;
    switch (body.kind) {
      case 'text':
        if (entry.subentry !== undefined) entry.subentryLines++;
        return;
      case 'subentry-start':
        // Consecutive start lines are headwords of one sub-entry; a start after other lines
        // implicitly closes the open sub-entry.
        if (entry.subentry !== undefined && entry.subentryLines > 0) this.unclosed(entry);
        if (entry.subentry === undefined || entry.subentryLines > 0) {
          entry.subentry = body;
          entry.subentryLines = 0;
        }
        return;
      case 'subentry-end':
        if (entry.subentry === undefined) {
          this.report(
            createDiagnostic('strayEndOfSubentry', 'A lone @ closes no open sub-entry.', {
              position: body.position,
            }),
          );
        }
        entry.subentry = undefined;
        return;
      default:
        unreachable(body);
    }
  }

  private unclosed(entry: OpenEntry): void {
    this.report(
      createDiagnostic('unclosedSubentry', 'The sub-entry is not closed by a lone @.', {
        position: entry.subentry?.position,
      }),
    );
  }

  private emit(): void {
    const entry = this.entry as OpenEntry;
    this.entry = undefined;
    if (entry.subentry !== undefined) this.unclosed(entry);
    this.output.push({
      headwords: entry.headwords,
      body: entry.body,
      position: entry.position,
      end: entry.end,
    });
  }
}

function unreachable(value: never): never {
  throw new TypeError(`Unexpected value: ${String(value)}`);
}

/** Classifies a logical line; `undefined` for a line that held only comments and spaces. */
function classify(line: LogicalLine): LineEvent | undefined {
  const { text } = line;
  if (text.length === 0) return line.comment ? undefined : 'blank';
  const first = text.charCodeAt(0);
  if (!isDslSpace(first)) return first === 0x23 ? 'directive' : 'headword';
  for (let i = 1; i < text.length; i++) {
    if (!isDslSpace(text.charCodeAt(i))) return 'indented';
  }
  return line.comment ? undefined : 'blank';
}

function rawLine(line: LogicalLine): RawLine {
  return line.segments === undefined
    ? { text: line.text, position: line.position }
    : { text: line.text, position: line.position, segments: line.segments };
}

/** Builds a body line: strips the indentation and detects sub-entry markers. */
function bodyLine(line: LogicalLine): BodyLine {
  const full = line.text;
  let start = 1;
  while (isDslSpace(full.charCodeAt(start))) start++;
  const indent = full.slice(0, start);
  const text = full.slice(start);
  const { position, segments } = shift(line, start);
  const marker = findSubentryMarker(text);
  let result: BodyLine;
  if (marker === -1) {
    result = { kind: 'text', text, indent, position };
  } else {
    const rest = text.slice(marker + 1);
    result = CLOSING_TAGS.test(rest)
      ? { kind: 'subentry-end', text, indent, position, marker }
      : { kind: 'subentry-start', text, indent, position, marker, headword: trimDslSpace(rest) };
  }
  if (segments !== undefined) (result as { segments?: LineSegment[] }).segments = segments;
  return result;
}

/** Position and segments of `line.text.slice(start)`. */
function shift(
  line: LogicalLine,
  start: number,
): { position: SourcePosition; segments: LineSegment[] | undefined } {
  const at = (base: LineSegment, index: number): SourcePosition => {
    const delta = index - base.index;
    const { offset, line: number, column } = base.position;
    return { offset: offset + delta, line: number, column: column + delta };
  };
  const { segments } = line;
  if (segments === undefined) {
    return { position: at({ index: 0, position: line.position }, start), segments: undefined };
  }
  let first = 0;
  while (first + 1 < segments.length && (segments[first + 1] as LineSegment).index <= start) {
    first++;
  }
  const base = segments[first] as LineSegment;
  const position = base.index === start ? base.position : at(base, start);
  if (first === segments.length - 1) return { position, segments: undefined };
  const shifted: LineSegment[] = [{ index: 0, position }];
  for (let i = first + 1; i < segments.length; i++) {
    const segment = segments[i] as LineSegment;
    shifted.push({ index: segment.index - start, position: segment.position });
  }
  return { position, segments: shifted };
}

/**
 * Index of the `@` that makes a body line a sub-entry marker, or -1. Like GoldenDict, the `@`
 * may be preceded by spaces, tabs and tags (`[m1]@ headword`); `\@` is a literal `@`.
 */
function findSubentryMarker(text: string): number {
  let i = 0;
  for (;;) {
    while (isDslSpace(text.charCodeAt(i))) i++;
    const c = text.charCodeAt(i);
    if (c === 0x40) return i;
    if (c !== 0x5b) return -1;
    const close = text.indexOf(']', i + 1);
    if (close <= i + 1) return -1;
    i = close + 1;
  }
}

/**
 * Creates a synchronous segmenter. It turns text (as produced by `decodeDsl`; a BOM and
 * `\r\n` or `\r` newlines are also accepted) into the header and a sequence of raw entries,
 * by the rules of `segmentDsl`. Internal: the engine behind `segmentDsl`, exposed for tests.
 */
export function createSegmenter(options: SegmenterOptions = {}): Segmenter {
  if (typeof options !== 'object' || options === null) {
    throw dslError('invalidArgument', 'Options must be an object.');
  }
  return new SegmenterImpl(options, true);
}

/** A segmenter for text from `decodeDsl`, which has no BOM left to strip. Internal. */
export function createDecodedTextSegmenter(options: SegmenterOptions): Segmenter {
  return new SegmenterImpl(options, false);
}
