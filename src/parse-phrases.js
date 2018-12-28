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
  debugger;
  const STATE = {
    INIT: 'INIT',
    TRANSLATION: 'TRANSLATION',
    EXAMPLE: 'EXAMPLE'
  };

  let transcription = null;
  let explanations = [];
  let translations = [];
  let examples = [];
  let currentState = STATE.INIT;

  // const isEntityBodyEmpty = () => !transcription && !translations.length && !examples.length;

  for (const bodyLine of body) {
    debugger;
    // Transcription
    if (transcriptionRegEx.test(bodyLine)) {
      const rawMatch = bodyLine.match(transcriptionRegEx);
      transcription = rawMatch[1];
    }

    // Translation
    if (translationRegEx.test(bodyLine)) {
      if (currentState === STATE.EXAMPLE) {
        let explanation = null;
        if (translations.length) {
          explanation = explanation || {};
          explanation.translations = translations;
        }

        if (examples.length) {
          explanation = explanation || {};
          explanation.examples = examples;
        }

        if (explanation) {
          explanations.push(explanation);
        }

        translations = [];
        examples = [];
      }
      
      currentState = STATE.TRANSLATION;
      const rawMatch = bodyLine.match(translationRegEx);
      const cleanedTranslation = rawMatch[1].replace(formatCleanerRegEx, '');
      translations.push(cleanedTranslation);
    }

    // Example
    if (exampleRegEx.test(bodyLine)) {
      currentState = STATE.EXAMPLE;
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

  // If we still in INIT state...
  if (currentState === STATE.INIT) {
    const explanation = {
      translations: []
    };
    for (const bodyLine of body) {
      explanation.translations.push(bodyLine);
    }

    explanations.push(explanation);
  } else if (translations.length || examples.length) {
    let explanation = null;
    if (translations.length) {
      explanation = explanation || {};
      explanation.translations = translations;
    }

    if (examples.length) {
      explanation = explanation || {};
      explanation.examples = examples;
    }

    if (explanation) {
      explanations.push(explanation);
    }
  }

  // Construct language entity
  const langEntity = {
    explanations
  };

  if (transcription) langEntity.transcription = transcription;
  // if (examples.length) langEntity.examples = examples;

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