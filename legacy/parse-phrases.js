// Imports
const ParseError = require('./ParseError');
const utils = require('./utils');
const langs = require('./languages');


// Prepeared RegExps
const transcriptionRegEx = /\[t\](.*?)\[\/t\]/;
const translationRegEx = /\[trn\](.*)\[\/trn\]/;
const exampleRegEx = /\[ex\](.*)\[\/ex\]/;
const langByIdRegEx = /\[lang id=(\d{1,5})\](.*)\[\/lang\](.*)/;
const langTargetExampleCleanerRegEx = /^\s?[-|—]\s?/;
const formatCleanerRegEx = /\[(p|\/p|i|\/i|com|\/com|\'|\/\'|\\'|\/\\')\]/g;


// Predicates
const isLineContainsTranscription = line => transcriptionRegEx.test(line);
const isLineContainsTranslation = line => translationRegEx.test(line);
const isLineContainsExample = line => exampleRegEx.test(line);


// Extractors
const extractTranscription = line => {
  const rawMatch = line.match(transcriptionRegEx);
  return rawMatch[1];
};

const extractTranslation = line => {
  const rawMatch = line.match(translationRegEx);
  const cleanedTranslation = rawMatch[1].replace(formatCleanerRegEx, '');
  return cleanedTranslation;
};

const extractExample = (line, dictLanguages) => {
  const rawMatch = line.match(exampleRegEx);
  const rawExample = rawMatch[1];
  if (langByIdRegEx.test(rawExample)) {
    const langExampleMatch = rawExample.match(langByIdRegEx);
    const sourceLang = langs.getLanguageById(langExampleMatch[1]);
    const targetLang = dictLanguages.getTargetLanguage();
    const sourceExample = langExampleMatch[2];
    const targetExample = langExampleMatch[3]
      .replace(formatCleanerRegEx, '')
      .replace(langTargetExampleCleanerRegEx, '');

    return {
      [sourceLang]: sourceExample,
      [targetLang]: targetExample
    };
  } else {
    return null;
  }
};

const packExplanation = (translations, examples) => {
  let explanation = null;

  if (translations.length) {
    explanation = explanation || {};
    explanation.translations = translations;
  }

  if (examples.length) {
    explanation = explanation || {};
    explanation.examples = examples;
  }

  return explanation;
};

const cleanHeader = header => header.trim();


// Entity parser
function *retrieveEntities(headers, body, dictLanguages) {
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

  for (const bodyLine of body) {
    // Transcription
    if (isLineContainsTranscription(bodyLine)) {
      transcription = extractTranscription(bodyLine);
    }

    // Translation
    if (isLineContainsTranslation(bodyLine)) {
      if (currentState === STATE.EXAMPLE) {
        const explanation = packExplanation(translations, examples);
        if (explanation) explanations.push(explanation);

        translations = [];
        examples = [];
      }

      currentState = STATE.TRANSLATION;
      translations.push(extractTranslation(bodyLine));
    }

    // Example
    if (isLineContainsExample(bodyLine)) {
      currentState = STATE.EXAMPLE;
      const example = extractExample(bodyLine, dictLanguages);
      if (example) examples.push(example);
    }
  } // end of for
  
  if (currentState === STATE.INIT) {
    // If we still in INIT state...
    for (const bodyLine of body) {
      translations.push(bodyLine);
    }

    explanations.push({
      translations
    });
  } else if (translations.length || examples.length) {
    // ...otherwise if some translation/example left unstored
    const explanation = packExplanation(translations, examples);
    if (explanation) explanations.push(explanation);
  }

  // Construct language entity
  const langEntity = {
    explanations
  };

  // Add transcription - if we have one
  if (transcription) langEntity.transcription = transcription;

  // Yield result - separate one for each card header
  for (const header of headers) {
    const cleanedHeader = cleanHeader(header);
    langEntity.phrase = cleanedHeader;
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