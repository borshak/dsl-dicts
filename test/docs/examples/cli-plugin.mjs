// headword-lengths.mjs: dsl-dicts convert en-de.dsl --plugin ./headword-lengths.mjs
// The default export is a DslPlugin: a name, the version of its output, and setup.

/** @type {import('dsl-dicts').DslPlugin<{ headword: string, length: number }>} */
export default {
  name: 'headword-lengths',
  version: '1.0.0',
  setup: () => (entry) => {
    const headword = entry.headwords[0]?.variants[0] ?? '';
    return { headword, length: [...headword].length };
  },
};
