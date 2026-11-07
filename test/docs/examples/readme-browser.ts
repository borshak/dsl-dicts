import { parseDsl } from 'dsl-dicts';
import { plainText } from 'dsl-dicts/plugins';

/** Lists the entries of a dictionary file as plain text: one string per entry. */
export async function listEntries(file: Blob): Promise<string[]> {
  const lines: string[] = [];
  for await (const { headwords, text } of parseDsl(file).entries({ plugin: plainText })) {
    lines.push(`${headwords.join(', ')}\n${text}`);
  }
  return lines;
}

// With <input type="file" accept=".dsl,.dz">:
// input.addEventListener('change', async () => console.log(await listEntries(input.files[0])));
