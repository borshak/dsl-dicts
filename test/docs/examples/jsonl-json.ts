import { toJson } from 'dsl-dicts';
import { openDsl } from 'dsl-dicts/node';
import { plainText } from 'dsl-dicts/plugins';

// One JSON document, { header, entries, summary }, for a small dictionary.
const dict = await openDsl('dictionaries/en-de.dsl.dz');
let json = '';
for await (const chunk of toJson(dict, { plugin: plainText, pretty: true })) json += chunk;
const { header, entries } = JSON.parse(json);
console.log(header.plugin, entries.length); // { name: 'plain-text', version: '1.0.0' } 2
