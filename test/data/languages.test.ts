import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { findLanguageById, findLanguageByName, LANGUAGES } from '../../src/data/index.js';

interface LegacyEntry {
  ID: number;
  'Old ID': number;
}

const require = createRequire(import.meta.url);
const legacy = require('../../legacy/languages.js') as {
  LANGUAGES: { BY_NAME: Record<string, LegacyEntry> };
};

describe('language table integrity', () => {
  it('has unique names', () => {
    const names = LANGUAGES.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique LCIDs, including alternative ones', () => {
    const ids = LANGUAGES.flatMap((l) => [l.lcid, ...(l.altLcids ?? [])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique legacy ids in the range 1-30', () => {
    const ids = LANGUAGES.flatMap((l) => (l.legacyId === undefined ? [] : [l.legacyId]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(30);
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('keeps legacy ids and LCIDs in disjoint ranges', () => {
    for (const l of LANGUAGES) {
      if (l.legacyId !== undefined) expect(l.legacyId).toBeLessThan(1000);
      expect(l.lcid).toBeGreaterThan(1000);
    }
  });

  it('uses well-formed names and codes', () => {
    for (const l of LANGUAGES) {
      expect(l.name).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(l.iso639_1).toMatch(/^[a-z]{2}$/);
      expect(l.iso639_3).toMatch(/^[a-z]{3}$/);
    }
  });

  it('contains every language of the legacy table with matching ids', () => {
    const entries = Object.entries(legacy.LANGUAGES.BY_NAME);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, old] of entries) {
      const language = findLanguageByName(name);
      expect(language, name).toBeDefined();
      expect(language?.lcid, name).toBe(old.ID);
      expect(language?.legacyId, name).toBe(old['Old ID']);
    }
  });

  it('knows the documented examples', () => {
    expect(findLanguageByName('English')).toMatchObject({
      lcid: 1033,
      legacyId: 1,
      iso639_1: 'en',
    });
    expect(findLanguageByName('Russian')).toMatchObject({ lcid: 1049, legacyId: 2 });
    expect(findLanguageByName('SpanishModernSort')?.lcid).toBe(3082);
    expect(findLanguageByName('GermanNewSpelling')?.lcid).toBe(32775);
    expect(findLanguageByName('ChinesePRC')?.lcid).toBe(2052);
  });
});

describe('language lookups', () => {
  it('round-trips by name', () => {
    for (const l of LANGUAGES) expect(findLanguageByName(l.name)).toBe(l);
  });

  it('round-trips by LCID, alternative LCID and legacy id', () => {
    for (const l of LANGUAGES) {
      expect(findLanguageById(l.lcid)).toBe(l);
      for (const alt of l.altLcids ?? []) expect(findLanguageById(alt)).toBe(l);
      if (l.legacyId !== undefined) expect(findLanguageById(l.legacyId)).toBe(l);
    }
  });

  it('resolves both Latin LCIDs', () => {
    expect(findLanguageById(1142)?.name).toBe('Latin');
    expect(findLanguageById(1540)?.name).toBe('Latin');
    expect(findLanguageById(30)?.name).toBe('Latin');
  });

  it('is case-sensitive by name', () => {
    expect(findLanguageByName('english')).toBeUndefined();
    expect(findLanguageByName('ENGLISH')).toBeUndefined();
  });

  it('returns undefined for unknown input', () => {
    expect(findLanguageByName('Klingon')).toBeUndefined();
    expect(findLanguageByName('')).toBeUndefined();
    expect(findLanguageByName('toString')).toBeUndefined();
    expect(findLanguageById(0)).toBeUndefined();
    expect(findLanguageById(31)).toBeUndefined();
    expect(findLanguageById(-1)).toBeUndefined();
    expect(findLanguageById(1.5)).toBeUndefined();
    expect(findLanguageById(Number.NaN)).toBeUndefined();
  });
});
