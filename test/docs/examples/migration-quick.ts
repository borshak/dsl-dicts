import { readFile } from 'node:fs/promises';
import { parseDsl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';

// 1.x took a decoded string; 2.0 takes the bytes and detects the encoding.
const dict = parseDsl(await readFile('dictionaries/en-de.dsl'));

// 1.x: dict.meta.name and dict.meta.language.{source, target}
const header = await dict.header;
console.log(header.name, header.indexLanguageInfo?.name, header.contentsLanguageInfo?.name);

// 1.x: for (const phrase of dict.phrase) — one item per headword, a synchronous iterator.
// 2.0: one item per entry (with all its headwords), an async iterator; errors reject.
for await (const entry of dict.entries({ plugin: article })) {
  console.log(
    entry.headwords.map((h) => h.text),
    entry.transcriptions,
    entry.senses.length,
  );
}
