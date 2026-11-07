/**
 * Incremental scan of the header area for `#SOURCE_CODE_PAGE`.
 *
 * @packageDocumentation
 */

/** A `#SOURCE_CODE_PAGE` directive found in the header area. */
export interface CodePageDirective {
  /** Raw value without quotes, e.g. `Cyrillic`. */
  readonly value: string;
  /** One-based line number of the directive. */
  readonly line: number;
  /** Offset of the start of the directive line in the scanned text. */
  readonly offset: number;
}

/** Longest prefix of a header line that is kept for parsing; directives are short. */
const MAX_LINE = 1024;

const DIRECTIVE = /^#SOURCE_CODE_PAGE[ \t]+(?:"([^"]*)"|(\S+))/i;

/** `fresh`: nothing seen on the line yet; `blank`: only spaces and tabs; `hash`: starts with `#`. */
type LineState = 'fresh' | 'blank' | 'hash';

/**
 * Scans newline-normalized text for the header area: the leading lines that start with `#` or
 * are blank. The scan stops at the first other line. Only the first `#SOURCE_CODE_PAGE` counts.
 *
 * The directive is ASCII in every supported encoding, so the scanner also works on a
 * provisional decoding where non-ASCII bytes are placeholders.
 */
export class HeaderScanner {
  /** The header area has ended (or input has ended). */
  done = false;
  directive: CodePageDirective | undefined;

  private state: LineState = 'fresh';
  private text = '';
  private line = 1;
  private offset = 0;
  private lineOffset = 0;

  /** Feeds the next chunk of text. Does nothing once the header area has ended. */
  push(chunk: string): void {
    let i = 0;
    while (!this.done && i < chunk.length) {
      const newline = chunk.indexOf('\n', i);
      const end = newline === -1 ? chunk.length : newline;
      this.feed(chunk, i, end);
      if (this.done) return;
      this.offset += end - i;
      if (newline === -1) return;
      this.endLine();
      this.offset++;
      this.lineOffset = this.offset;
      this.line++;
      i = newline + 1;
    }
  }

  /** Signals the end of input: the last line may lack a newline. */
  end(): void {
    if (!this.done) this.endLine();
    this.done = true;
  }

  /** Copies the scanner, to look ahead on provisional text without disturbing this one. */
  clone(): HeaderScanner {
    return Object.assign(new HeaderScanner(), this);
  }

  private feed(chunk: string, start: number, end: number): void {
    let i = start;
    while (this.state !== 'hash' && i < end) {
      const c = chunk.charCodeAt(i);
      if (c === 0x20 || c === 0x09) {
        this.state = 'blank';
      } else if (c === 0x23 && this.state === 'fresh') {
        this.state = 'hash';
        break;
      } else {
        this.done = true;
        return;
      }
      i++;
    }
    if (this.state === 'hash' && this.text.length < MAX_LINE) {
      this.text += chunk.slice(i, Math.min(end, i + MAX_LINE - this.text.length));
    }
  }

  private endLine(): void {
    if (this.state === 'hash' && this.directive === undefined) {
      const match = DIRECTIVE.exec(this.text);
      if (match) {
        const value = (match[1] ?? match[2] ?? '').trim();
        this.directive = { value, line: this.line, offset: this.lineOffset };
      }
    }
    this.state = 'fresh';
    this.text = '';
  }
}
