import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, isKnownColor } from '../../src/data/index.js';

describe('color names', () => {
  it('are lowercase letters only', () => {
    for (const name of COLOR_NAMES) expect(name).toMatch(/^[a-z]+$/);
  });

  it('are unique', () => {
    expect(new Set(COLOR_NAMES).size).toBe(COLOR_NAMES.length);
  });

  it('are sorted alphabetically', () => {
    expect([...COLOR_NAMES]).toEqual([...COLOR_NAMES].sort());
  });

  it('include representative names', () => {
    for (const name of ['red', 'darkgreen', 'aliceblue', 'slategray', 'firebrick', 'yellowgreen']) {
      expect(COLOR_NAMES).toContain(name);
    }
  });
});

describe('isKnownColor', () => {
  it('accepts known lowercase names', () => {
    expect(isKnownColor('red')).toBe(true);
    expect(isKnownColor('darkgreen')).toBe(true);
  });

  it('is case-sensitive, like Lingvo', () => {
    expect(isKnownColor('Red')).toBe(false);
    expect(isKnownColor('RED')).toBe(false);
  });

  it('rejects unknown input', () => {
    expect(isKnownColor('')).toBe(false);
    expect(isKnownColor('notacolor')).toBe(false);
    expect(isKnownColor('#ff0000')).toBe(false);
    expect(isKnownColor('toString')).toBe(false);
  });
});
