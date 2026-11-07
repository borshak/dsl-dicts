import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { findLanguageByName } from '../../src/data/index.js';

interface LegacyEntry {
  ID: number;
  'Old ID': number;
}

const require = createRequire(import.meta.url);
const legacy = require('../../legacy/languages.js') as {
  LANGUAGES: { BY_NAME: Record<string, LegacyEntry> };
};

describe('language table against the legacy table', () => {
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
});
