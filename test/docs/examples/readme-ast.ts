import { parseDsl, walk } from 'dsl-dicts';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

colo(u)r
\t[m1][p]n[/p] [trn]Farbe[/trn], see <<hue>>
`;

for await (const entry of parseDsl(text).entries()) {
  const [headword] = entry.headwords;
  console.log(headword?.text, headword?.variants); // colo(u)r [ 'color', 'colour' ]
  walk(entry.body, (node) => {
    if (node.type === 'tag') console.log('tag', node.name); // m, p, trn
    if (node.type === 'link') console.log('link', node.children); // [ { type: 'text', ... } ]
  });
}
