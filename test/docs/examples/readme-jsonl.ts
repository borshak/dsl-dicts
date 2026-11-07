import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { toJsonl } from 'dsl-dicts';
import { article } from 'dsl-dicts/article';
import { openDsl } from 'dsl-dicts/node';

const dict = await openDsl('dictionaries/en-de.dsl.dz');
const lines = toJsonl(dict, { plugin: article, summary: true });
await pipeline(Readable.from(lines), createWriteStream('en-de.article.jsonl'));
