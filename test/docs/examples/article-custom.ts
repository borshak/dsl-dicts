import { parseDsl } from 'dsl-dicts';
import {
  type Article,
  classifyBody,
  createArticlePlugin,
  extractZoneMarked,
} from 'dsl-dicts/article';

// A profile for a family of dictionaries that the built-in extractors read poorly.
const myArticle = createArticlePlugin({
  name: 'my-article',
  version: '1.0.0',
  extractors: {
    // Starts from the built-in reading and drops the text it could not place.
    'my-family': (body, context) => ({ ...extractZoneMarked(body, context), notes: [] }),
  },
  classify: (body, context) =>
    context.dictionary.header.name?.startsWith('Tiny ') ? 'my-family' : classifyBody(body, context),
});

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn] (rarely used)
`;
const articles: Article[] = [];
for await (const entry of parseDsl(text).entries({ plugin: myArticle })) articles.push(entry);
console.log(articles.map(({ kind, senses, notes }) => ({ kind, senses: senses.length, notes })));
// [ { kind: 'my-family', senses: 1, notes: undefined } ]
