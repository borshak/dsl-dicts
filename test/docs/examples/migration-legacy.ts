import type { DslHeader } from 'dsl-dicts';
import type { Article, Sense } from 'dsl-dicts/article';

/** A phrase of dsl-dicts 1.x. */
export interface LegacyPhrase {
  phrase: string;
  transcription?: string;
  explanations: { translations: string[]; examples?: Record<string, string>[] }[];
}

/** The 1.x phrases of an article: one per headword, an explanation per sense with content. */
export function toLegacyPhrases(article: Article, header: DslHeader): LegacyPhrase[] {
  const target = header.contentsLanguageInfo?.name ?? 'target';
  const explanations: LegacyPhrase['explanations'] = [];
  const visit = (senses: readonly Sense[]): void => {
    for (const { translations, examples, senses: children } of senses) {
      const pairs = examples.map(({ source, target: text }) => ({
        [source.language ?? 'source']: source.text,
        [target]: text?.text ?? '',
      }));
      if (translations.length > 0 || pairs.length > 0) {
        explanations.push({
          translations: [...translations],
          ...(pairs.length > 0 && { examples: pairs }),
        });
      }
      visit(children);
    }
  };
  visit(article.senses);
  const [transcription] = article.transcriptions;
  // A fresh object per headword: 1.x shared one, and only the last headword survived.
  return article.headwords.map(({ text }) => ({
    phrase: text,
    ...(transcription !== undefined && { transcription }),
    explanations: structuredClone(explanations),
  }));
}

// const header = await dict.header;
// for await (const entry of dict.entries({ plugin: article, options: { splitTranslations: false } }))
//   for (const phrase of toLegacyPhrases(entry, header)) console.log(phrase);
