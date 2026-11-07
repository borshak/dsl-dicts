// Imports
const ParseError = require('./ParseError');

const LANGUAGES = {
};

LANGUAGES.BY_NAME = Object.freeze({
  English: {
    ID: 1033,
    'Old ID': 1,
    'ISO 639-1': 'En',
    'ISO 639-2': 'eng'
  },
  Russian: {
    ID: 1049,
    'Old ID': 2,
    'ISO 639-1': 'Ru',
    'ISO 639-2': 'rus'
  },
  German: {
    ID: 1031,
    'Old ID': 3,
    'ISO 639-1': 'De',
    'ISO 639-2': 'deu, ger'
  },
  French: {
    ID: 1036,
    'Old ID': 4,
    'ISO 639-1': 'Fr',
    'ISO 639-2': 'fra, fre'
  },
  Italian: {
    ID: 1040,
    'Old ID': 5,
    'ISO 639-1': 'It',
    'ISO 639-2': 'ita'
  },
  SpanishModernSort: {
    ID: 3082,
    'Old ID': 6,
    'ISO 639-1': 'Es',
    'ISO 639-2': 'esl, spa'
  },
  SpanishTraditionalSort: {
    ID: 1034,
    'Old ID': 7,
    'ISO 639-1': 'Es',
    'ISO 639-2': 'esl, spa'
  },
  PortugueseStandard: {
    ID: 2070,
    'Old ID': 8,
    'ISO 639-1': 'Pt',
    'ISO 639-2': 'por'
  },

  // ...

  Ukrainian: {
    ID: 1058,
    'Old ID': 24,
    'ISO 639-1': 'Uk',
    'ISO 639-2': 'ukr'
  },
  GermanNewSpelling: {
    ID: 32775,
    'Old ID': 26,
    'ISO 639-1': 'De',
    'ISO 639-2': 'deu, ger'
  },
  Latin: {
    ID: 1142,
    'Old ID': 30,
    'ISO 639-1': 'La',
    'ISO 639-2': 'lat'
  },
});

LANGUAGES.BY_ID = Object.freeze({
  1033: 'English',
  1049: 'Russian',
  1031: 'German',
  1036: 'French',
  1040: 'Italian',
  3082: 'SpanishModernSort',
  1034: 'SpanishTraditionalSort',
  2070: 'PortugueseStandard',
  1058: 'Ukrainian',
  32775: 'GermanNewSpelling',
  1142: 'Latin'
});

const getSourceLanguageFromMeta = meta => {
  if (meta 
    && meta 
    && meta.language 
    && meta.language.source
    && meta.language.source in LANGUAGES.BY_NAME) {
      return meta.language.source;
    } else {
      throw new ParseError('Unsupported souce language.');
    }
};

const getTargetLanguageFromMeta = meta => {
  if (meta 
    && meta 
    && meta.language 
    && meta.language.target
    && meta.language.target in LANGUAGES.BY_NAME) {
      return meta.language.target;
    } else {
      throw new ParseError('Unsupported target language.');
    }
};

const getLanguageById = id => {
  if (id in LANGUAGES.BY_ID) {
    return LANGUAGES.BY_ID[id];
  } else {
    throw new ParseError(`Can't handle unsupported language with ID ${id}`);
  }
}; 

class DictLanguages {
  constructor(meta) {
    this.sourceLanguage = getTargetLanguageFromMeta(meta);
    this.targetLanguage = getTargetLanguageFromMeta(meta);
  }

  getSourceLanguage() {
    return this.sourceLanguage;
  }

  getTargetLanguage() {
    return this.targetLanguage;
  }
}

module.exports = {
  LANGUAGES,
  DictLanguages,
  getLanguageById
};