/**
 * The small invented dictionaries the documentation examples run on. Web-standard APIs only.
 */

/** The header of the examples' dictionaries. */
export const HEADER =
  '#NAME "Tiny English-German"\n#INDEX_LANGUAGE "English"\n#CONTENTS_LANGUAGE "German"\n\n';

/** The dictionary the examples call `dictionaries/en-de.dsl.dz`, uncompressed. */
export const EN_DE = `${HEADER}cat
\t[m1]1) [p]n[/p] [trn]Katze[/trn]
\t[m2][ex][lang id=1033]a black ~[/lang] — eine schwarze Katze[/ex]
\t[m1]2) [p]coll.[/p] [trn]Kerl; Typ[/trn]
colo(u)r
\t[m1][p]n[/p] [trn]Farbe[/trn]
\t[m1][ex][lang id=1033]a bright ~[/lang] — eine helle Farbe[/ex]
`;

/** Its abbreviations file, `dictionaries/en-de_abrv.dsl`. */
export const EN_DE_ABBREVIATIONS = 'n\n\tnoun\ncoll.\n\tcolloquial\n';

/** An 8-bit dictionary in windows-1252 without `#SOURCE_CODE_PAGE`, as text. */
export const OLD_DE = `#NAME "Tiny German-English"
#INDEX_LANGUAGE "German"
#CONTENTS_LANGUAGE "English"

Bär
\t[m1][trn]bear[/trn]
Größe
\t[m1][trn]size[/trn]
`;

/** Encodes text as windows-1252 (Latin-1 range only). */
export function latin1(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => {
    const code = c.charCodeAt(0);
    if (code > 0xff) throw new Error(`Not Latin-1: ${c}`);
    return code;
  });
}

/** Gzips text, as a `.dsl.dz` would be. */
export async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
