import { describe, expect, it } from 'vitest';
import {
  createStrictSink,
  DslError,
  parseHeadword,
  parseHeadwords,
  parseMarkup,
} from '../../src/index.js';
import { hw } from './helpers.js';

describe('headword API', () => {
  it('rejects invalid arguments with DSL0001', () => {
    const bad: unknown[] = [
      () => parseHeadword(42 as never),
      () => parseHeadword(null as never),
      () => parseHeadword('x', null as never),
      () => parseHeadword('x', { tilde: 1 as never }),
      () => parseHeadwords(null as never),
      () => parseHeadwords({ headwords: 'x' } as never),
      () => parseHeadwords({ headwords: [] }, 'x' as never),
    ];
    for (const call of bad) {
      expect(call).toThrow(DslError);
      expect(call).toThrow(expect.objectContaining({ code: 'DSL0001' }) as never);
    }
  });

  it('gives positions relative to an origin', () => {
    const origin = { offset: 10, line: 3, column: 5 };
    const headword = parseHeadword('  {a}b', { origin });
    expect(headword.position).toEqual({ offset: 12, line: 3, column: 7 });
    expect(headword.end).toEqual({ offset: 16, line: 3, column: 11 });
    expect(headword.display).toEqual([
      {
        type: 'text',
        text: 'ab',
        position: { offset: 13, line: 3, column: 8 },
        end: { offset: 16, line: 3, column: 11 },
      },
    ]);
  });

  it('displays like parseMarkup, braces aside', () => {
    const text = "[c red]a[/c] [']b[/'] [b]c[i]d[/b]e[/i]";
    const braced = text.replace(/\[[^\]]*\]/g, '{$&}');
    expect(hw(braced).headword.display).toEqual(parseMarkup(text, { positions: false }));
  });

  it('does not throw from a strict sink: headword problems are not errors', () => {
    expect(() => parseHeadword('{a(b', { diagnostics: createStrictSink() })).not.toThrow();
  });

  it('returns empty results for an empty headword', () => {
    const { headword, codes } = hw('');
    expect(headword).toEqual({ raw: '', display: [], text: '', variants: [] });
    expect(codes).toEqual(['DSL3201']);
  });
});
