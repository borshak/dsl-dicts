import { parseDsl } from 'dsl-dicts';
import { plainText, searchText } from 'dsl-dicts/plugins';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

colo(u)r
\t[m1][p]n[/p] [trn]Farbe[/trn] [com](of light)[/com]
\t[m2][ex][lang id=1033]a bright ~[/lang] — eine helle Farbe[/ex]
`;
const abbreviations = new Map([['n', 'noun']]);

const plain = parseDsl(text, { abbreviations });
for await (const result of plain.entries({
  plugin: plainText,
  options: { indent: '  ', expandLabels: true },
})) {
  console.log(result);
  // { headwords: [ 'colo(u)r' ], text: '  noun Farbe (of light)\n    a bright color — eine helle Farbe' }
}

for await (const result of parseDsl(text).entries({ plugin: searchText })) {
  console.log(result);
  // { forms: [ 'color', 'colour' ], text: 'Farbe\n(of light)\na bright color — eine helle Farbe' }
}
