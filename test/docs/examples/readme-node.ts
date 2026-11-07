import { article } from 'dsl-dicts/article';
import { openDsl } from 'dsl-dicts/node';

// A .dsl or .dsl.dz file; its companion files (_abrv.dsl, .ann) are found next to it.
const dict = await openDsl('dictionaries/en-de.dsl.dz');
const header = await dict.header;
console.log(`${header.name}: ${header.indexLanguage} -> ${header.contentsLanguage}`);

for await (const entry of dict.entries({ plugin: article })) {
  const headwords = entry.headwords.map((headword) => headword.text).join(', ');
  const translations = entry.senses.flatMap((sense) => sense.translations).join('; ');
  console.log(`${headwords}: ${translations}`);
}
