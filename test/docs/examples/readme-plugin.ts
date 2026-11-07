import { DslError, definePlugin, parseDsl, toPlainText } from 'dsl-dicts';

interface GlossaryOptions {
  /** Between the headwords and the text. Default `': '`. */
  readonly separator?: string;
}

/** One line per entry: the headwords, then the body as plain text. */
export const glossary = definePlugin({
  name: 'glossary',
  version: '1.0.0',
  setup(_context, options: GlossaryOptions | undefined) {
    const separator = options?.separator ?? ': ';
    if (typeof separator !== 'string') {
      throw new DslError('DSL0001', 'The separator option must be a string.');
    }
    return (entry) => {
      const text = toPlainText(entry.body, { headwords: entry.headwords });
      return `${entry.headwords.map((h) => h.text).join(', ')}${separator}${text.replaceAll('\n', ' ')}`;
    };
  },
});

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][p]n[/p] [trn]Katze[/trn]
`;
for await (const line of parseDsl(text).entries({
  plugin: glossary,
  options: { separator: ' = ' },
})) {
  console.log(line); // cat = n Katze
}
