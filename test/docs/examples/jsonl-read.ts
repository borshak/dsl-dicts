import { createReadStream } from 'node:fs';
import { AST_VERSION, DslError, readJsonl } from 'dsl-dicts';
import { type Article, article } from 'dsl-dicts/article';

try {
  const { header, records } = await readJsonl<Article>(
    createReadStream('en-de.article.jsonl', 'utf8'),
    // Refuse a document this code does not understand.
    { astVersion: AST_VERSION, plugin: { name: article.name, version: article.version } },
  );
  console.log(header.dictionary.name, header.plugin); // Tiny English-German { name: 'article', ... }
  for await (const record of records) {
    if (record.type === 'entry') console.log(record.data.headwords[0]?.text);
    else console.log(`${record.entries} entries`, record.diagnostics);
  }
} catch (error) {
  // DSL7001-DSL7005: not a dsl-dicts document, or a version this code cannot read.
  if (error instanceof DslError && error.code.startsWith('DSL700')) console.error(error.message);
  else throw error;
}
