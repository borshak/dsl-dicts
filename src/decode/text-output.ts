/**
 * Final text stage shared by byte and string input: newline normalization, position tracking
 * and the header scan.
 *
 * @packageDocumentation
 */

import type { SourcePosition } from '../diagnostics/index.js';
import { HeaderScanner } from './header.js';

/**
 * Converts `\r\n` and lone `\r` to `\n`, correctly across chunk boundaries. A chunk ending in
 * `\r` is converted at once; a `\n` at the start of the next chunk is then dropped. Nothing is
 * held back, so output offsets never lag behind the input.
 */
export class NewlineNormalizer {
  private skipLineFeed = false;

  push(chunk: string): string {
    let text = chunk;
    if (this.skipLineFeed && text.length > 0) {
      this.skipLineFeed = false;
      if (text.charCodeAt(0) === 0x0a) text = text.slice(1);
    }
    if (text.length === 0) return '';
    if (text.charCodeAt(text.length - 1) === 0x0d) this.skipLineFeed = true;
    return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
  }
}

/** Normalized text sink that tracks positions and scans the header area. */
export class TextOutput {
  readonly header = new HeaderScanner();
  private readonly newlines = new NewlineNormalizer();
  /** Length of the normalized text emitted so far. */
  private offset = 0;
  private line = 1;
  private lineOffset = 0;

  /** Normalizes a chunk of decoded text, updates positions and the header scan. */
  write(chunk: string, inspect?: (text: string) => void): string {
    const text = this.newlines.push(chunk);
    if (text.length === 0) return text;
    if (!this.header.done) this.header.push(text);
    inspect?.(text);
    this.advance(text);
    return text;
  }

  /** Ends the input. */
  end(): void {
    this.header.end();
  }

  /**
   * Position of `index` in `text`, the chunk being written. Valid only inside the `inspect`
   * callback of {@link TextOutput.write}, before the chunk is accounted for.
   */
  positionIn(text: string, index: number): SourcePosition {
    let line = this.line;
    let lineOffset = this.lineOffset;
    for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
      line++;
      lineOffset = this.offset + i + 1;
    }
    const offset = this.offset + index;
    return { offset, line, column: offset - lineOffset + 1 };
  }

  private advance(text: string): void {
    let last = -1;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
      this.line++;
      last = i;
    }
    if (last !== -1) this.lineOffset = this.offset + last + 1;
    this.offset += text.length;
  }
}
