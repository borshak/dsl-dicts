// Imports
const ParseError = require('./ParseError');
const utils = require('./utils');
const langs = require('./languages');

// Prepeared RegExps
const transcriptionRegEx = /\[t\](.*)\[\/t\]/;
const translationRegEx = /\[trn\](.*)\[\/trn\]/;
const exampleRegEx = /\[ex\](.*)\[\/ex\]/;
const langByIdRegEx = /\[lang id=(\d{1,5})\](.*)\[\/lang\](.*)/;
const langTargetExampleCleanerRegEx = /^\s?[-|—]\s?/;
const formatCleanerRegEx = /\[(p|\/p|i|\/i|com|\/com|\'|\/\'|\\'|\/\\')\]/g;


function *retrieveEntities(headers, body, dictLanguages) {
  let transcription = null;
  let translations = [];
  let examples = [];

  const isEntityBodyEmpty = () => !transcription && !translations.length && !examples.length;

  for (const bodyLine of body) {
    // Transcription
    if (transcriptionRegEx.test(bodyLine)) {
      const rawMatch = bodyLine.match(transcriptionRegEx);
      transcription = rawMatch[1];
    }

    // Translation
    if (translationRegEx.test(bodyLine)) {
      const rawMatch = bodyLine.match(translationRegEx);
      const cleanedTranslation = rawMatch[1].replace(formatCleanerRegEx, '');
      translations.push(cleanedTranslation);
    }

    // Example
    if (exampleRegEx.test(bodyLine)) {
      const rawMatch = bodyLine.match(exampleRegEx);
      const rawExample = rawMatch[1];
      if (langByIdRegEx.test(rawExample)) {
        const langExampleMatch = rawExample.match(langByIdRegEx);
        const sourceLang = langs.getLanguageById(langExampleMatch[1]);
        const targetLang = dictLanguages.getTargetLanguage();
        const sourceExample = langExampleMatch[2];
        const targetExample = langExampleMatch[3]
          .replace(formatCleanerRegEx, '')
          .replace(langTargetExampleCleanerRegEx, '');
        
          examples.push({
          [sourceLang]: sourceExample,
          [targetLang]: targetExample
        });
      }
    }
  }

  if (isEntityBodyEmpty()) {
    for (const bodyLine of body) {
      translations.push(bodyLine);
    }
  }

  // Construct language entity
  const langEntity = {
    translations
  };

  if (transcription) langEntity.transcription = transcription;
  if (examples.length) langEntity.examples = examples;

  // Yield result
  for (const header of headers) {
    langEntity.phrase = header;
    yield langEntity;
  }
};


// Entry point
function *parsePhrases(dslContent, dictLanguages) {
  let entityBeginIndex = utils.indexOfFirstLangEntity(dslContent);
  let entityEndIndex = utils.indexOfNextLangEntity(dslContent, entityBeginIndex);

  while (entityEndIndex !== -1) {
    // Parse current phrase
    const rawEntity = dslContent.substring(entityBeginIndex, entityEndIndex);
    const splitted = utils.splitByEndOfLine(rawEntity);
    const filtered = splitted.filter(str => !utils.isEmptyStr(str));
    const headerLines = filtered.filter(str => !utils.isStartWithSpaceOrTab(str));
    const bodyLines = filtered.filter(str => utils.isStartWithSpaceOrTab(str));
    const cleanedBodyLines = bodyLines.map(str => str.trim());

    // Retrieve & yield
    const langEntities = retrieveEntities(headerLines, cleanedBodyLines, dictLanguages);
    for (const langEntity of langEntities) {
      yield langEntity;
    }

    // Iter over next phrase
    entityBeginIndex = entityEndIndex;
    entityEndIndex = utils.indexOfNextLangEntity(dslContent, entityBeginIndex);
  }
};

// Exports
module.exports = parsePhrases;