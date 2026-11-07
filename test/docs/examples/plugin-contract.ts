import { createPluginDiagnostic, DslError, definePlugin, parseDsl, zoneText } from 'dsl-dicts';

/** Options of the `translations` plugin. */
export interface TranslationsOptions {
  /** The zone tags whose text is a translation. Default `['trn']`. */
  readonly zones?: readonly string[];
}

/** What the plugin makes of an entry: JSON-serializable, so that it can be exported. */
export interface TranslationsResult {
  readonly headword: string;
  readonly translations: readonly string[];
}

export const translations = definePlugin({
  name: 'translations',
  version: '1.0.0',
  setup(context, options: TranslationsOptions | undefined) {
    // Once per dictionary: check the options, prepare lookups.
    const zones = options?.zones ?? ['trn'];
    if (!Array.isArray(zones)) {
      throw new DslError('DSL0001', 'The zones option must be an array of tag names.');
    }
    // Once per entry, synchronously: exactly one result.
    return (entry): TranslationsResult => {
      const text = zoneText(entry.body, { zones, headwords: entry.headwords });
      if (text.length === 0) {
        context.diagnostics.report(
          createPluginDiagnostic('translations', 'The entry has no translation.', {
            code: 'translations/none',
            severity: 'info',
            position: entry.position,
          }),
        );
      }
      return {
        headword: entry.headwords[0]?.text ?? '',
        translations: text.length === 0 ? [] : text.split('\n'),
      };
    };
  },
});

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn]
dog
\t[m1]see <<hound>>
`;
const dict = parseDsl(text);
for await (const result of dict.entries({ plugin: translations })) console.log(result);
// { headword: 'cat', translations: [ 'Katze' ] }
// { headword: 'dog', translations: [] }
console.log(dict.diagnostics.map((d) => `${d.code} ${d.source} ${d.message}`));
// [ 'translations/none translations translations: The entry has no translation.' ]
