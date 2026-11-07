import { parseDsl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m0][t]kæt[/t]
\t[m1]1) [p]n[/p] [trn]Katze; Kater[/trn]
\t[m2][ex][lang id=1033]a black ~[/lang] — eine schwarze Katze[/ex]
\t[m1]2) [p]coll.[/p] [trn]Kerl[/trn] [com](a man)[/com]
`;
const abbreviations = new Map([
  ['n', 'noun'],
  ['coll.', 'colloquial'],
]);

for await (const entry of parseDsl(text, { abbreviations }).entries({ plugin: article })) {
  console.log(JSON.stringify(entry, null, 2));
}
