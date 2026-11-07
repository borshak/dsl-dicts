import { describe, expect, it } from 'vitest';
import { findLingvoCodePage, LINGVO_CODE_PAGES, WHATWG_ENCODINGS } from '../../src/data/index.js';

describe('Lingvo code pages', () => {
  it('are sorted by name and map to distinct windows code pages', () => {
    const names = LINGVO_CODE_PAGES.map((page) => page.name);
    expect(names).toEqual([...names].sort());
    const encodings = LINGVO_CODE_PAGES.map((page) => page.encoding);
    expect(new Set(encodings).size).toBe(encodings.length);
    for (const encoding of encodings) expect(WHATWG_ENCODINGS).toContain(encoding);
  });

  it('marks only Hebrew and Vietnamese as unverified', () => {
    const unverified = LINGVO_CODE_PAGES.filter((page) => !page.verified).map((p) => p.name);
    expect(unverified).toEqual(['Hebrew', 'Vietnamese']);
  });

  it('are found leniently', () => {
    expect(findLingvoCodePage('Cyrillic')?.encoding).toBe('windows-1251');
    expect(findLingvoCodePage('CYRILLIC')?.encoding).toBe('windows-1251');
    expect(findLingvoCodePage('Eastern European')?.encoding).toBe('windows-1250');
    expect(findLingvoCodePage('eastern_european')?.encoding).toBe('windows-1250');
    expect(findLingvoCodePage('Eastern-European')?.encoding).toBe('windows-1250');
    expect(findLingvoCodePage('Klingon')).toBeUndefined();
    expect(findLingvoCodePage('')).toBeUndefined();
  });

  it('are decodable by this runtime', () => {
    for (const { encoding } of LINGVO_CODE_PAGES) {
      expect(new TextDecoder(encoding).encoding).toBe(encoding);
    }
  });
});

describe('WHATWG encodings', () => {
  it('are unique lowercase canonical names', () => {
    expect(new Set(WHATWG_ENCODINGS).size).toBe(WHATWG_ENCODINGS.length);
    for (const name of WHATWG_ENCODINGS) expect(name).toBe(name.toLowerCase());
  });

  it('are canonical where the runtime supports them', () => {
    for (const name of WHATWG_ENCODINGS) {
      try {
        expect(new TextDecoder(name).encoding).toBe(name);
      } catch {
        // Unsupported by this runtime (e.g. `replacement`, or iso-8859-16 on Node.js 22).
      }
    }
  });
});
