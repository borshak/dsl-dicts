// Minimal typings so the legacy implementation can be imported from TypeScript tests.
export interface Explanation {
  translations: string[];
  examples?: Record<string, string>[];
}

export interface Entry {
  phrase: string;
  explanations: Explanation[];
}

export interface Dictionary {
  meta: { name: string; language: { source: string; target: string } };
  phrase: Iterator<Entry>;
}

export function parse(dslContent: string): Promise<Dictionary>;
