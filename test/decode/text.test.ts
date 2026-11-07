import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HeaderScanner } from '../../src/decode/header.js';
import { NewlineNormalizer, TextOutput } from '../../src/decode/text-output.js';

function normalize(chunks: readonly string[]): string {
  const normalizer = new NewlineNormalizer();
  return chunks.map((chunk) => normalizer.push(chunk)).join('');
}

describe('NewlineNormalizer', () => {
  it('converts CRLF, CR and LF to LF', () => {
    expect(normalize(['a\r\nb\rc\nd'])).toBe('a\nb\nc\nd');
    expect(normalize(['\r\r\n\n\r'])).toBe('\n\n\n\n');
  });

  it('joins CR and LF split across chunks into one newline', () => {
    expect(normalize(['a\r', '\nb'])).toBe('a\nb');
    expect(normalize(['a\r', '', '\nb'])).toBe('a\nb');
    expect(normalize(['a\r', '\r', '\n', 'b'])).toBe('a\n\nb');
    expect(normalize(['\r', '\n'])).toBe('\n');
  });

  it('is independent of chunk boundaries', () => {
    const text = fc.string({ unit: fc.constantFrom('\r', '\n', 'a', '𝄞'), maxLength: 60 });
    fc.assert(
      fc.property(text, fc.array(fc.nat(60)), (t, cuts) => {
        const points = [...new Set(cuts.map((c) => Math.min(c, t.length)))].sort((a, b) => a - b);
        const chunks = [0, ...points].map((p, i, all) => t.slice(p, all[i + 1] ?? t.length));
        expect(normalize(chunks)).toBe(t.replace(/\r\n?/g, '\n'));
      }),
    );
  });
});

describe('TextOutput positions', () => {
  it('computes offset, line and column within and across chunks', () => {
    const output = new TextOutput();
    output.write('ab\r\ncd');
    const positions: unknown[] = [];
    output.write('e\nfg\r', (text) => {
      positions.push(output.positionIn(text, 0), output.positionIn(text, 3));
    });
    output.write('\nh', (text) => positions.push(output.positionIn(text, 0)));
    expect(positions).toEqual([
      { offset: 5, line: 2, column: 3 },
      { offset: 8, line: 3, column: 2 },
      { offset: 10, line: 4, column: 1 },
    ]);
  });
});

describe('HeaderScanner', () => {
  function scan(chunks: readonly string[]): HeaderScanner {
    const scanner = new HeaderScanner();
    for (const chunk of chunks) scanner.push(chunk);
    return scanner;
  }

  it('finds the directive and its position', () => {
    const scanner = scan(['#NAME "x"\n\n  \n#SOURCE_CODE_PAGE "Latin"\nword\n']);
    expect(scanner.done).toBe(true);
    expect(scanner.directive).toEqual({ value: 'Latin', line: 4, offset: 14 });
  });

  it('works on single-character chunks', () => {
    const scanner = scan([...'#A\n#SOURCE_CODE_PAGE "Greek"\nword']);
    expect(scanner.directive).toEqual({ value: 'Greek', line: 2, offset: 3 });
  });

  it('keeps the first directive only', () => {
    const scanner = scan(['#SOURCE_CODE_PAGE "Latin"\n#SOURCE_CODE_PAGE "Greek"\n']);
    expect(scanner.directive?.value).toBe('Latin');
  });

  it('stops at the first line that is neither blank nor a # line', () => {
    expect(scan(['#NAME "x"\nword\n#SOURCE_CODE_PAGE "Latin"\n']).directive).toBeUndefined();
    expect(scan(['\t#SOURCE_CODE_PAGE "Latin"\n']).directive).toBeUndefined();
    expect(scan(['word']).done).toBe(true);
  });

  it('needs end() for a directive on the last line without a newline', () => {
    const scanner = scan(['#SOURCE_CODE_PAGE "Latin"']);
    expect(scanner.directive).toBeUndefined();
    expect(scanner.done).toBe(false);
    scanner.end();
    expect(scanner.directive?.value).toBe('Latin');
    expect(scanner.done).toBe(true);
  });

  it('clones independently', () => {
    const scanner = scan(['#NAME "x"\n#SOURCE_']);
    const copy = scanner.clone();
    copy.push('CODE_PAGE "Latin"\n');
    expect(copy.directive?.value).toBe('Latin');
    expect(scanner.directive).toBeUndefined();
    scanner.push('CODE_PAGE "Greek"\n');
    expect(scanner.directive?.value).toBe('Greek');
  });
});
