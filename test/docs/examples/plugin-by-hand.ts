import { createDictionaryContext, parseBody, parseDsl, setupPlugin } from 'dsl-dicts';
import { plainText } from 'dsl-dicts/plugins';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn]
dog
\t[m1][trn]Hund[/trn]
`;

// Raw mode: the headwords are parsed, the bodies are not, until needed.
const dict = parseDsl(text, { body: 'raw' });
const context = createDictionaryContext({ header: await dict.header });
const render = setupPlugin(plainText, context, { indent: '  ' });

for await (const entry of dict.entries()) {
  if (!entry.headwords.some((headword) => headword.variants.includes('dog'))) continue;
  console.log(render({ ...entry, body: parseBody(entry) })); // { headwords: [ 'dog' ], text: '  Hund' }
}
