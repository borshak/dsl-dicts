// imports
const ParseError = require('./ParseError');
const parseMeta = require('./parse-meta');
const parsePhrases = require('./parse-phrases');
const langs = require('./languages');

// Entry point
const parse = dslContent => {
  return new Promise((resolve, reject) => {
    if (!dslContent) {
      reject(new ParseError());
    }

    const dictionaryMeta = parseMeta(dslContent);
    const dictLanguages = new langs.DictLanguages(dictionaryMeta);

    resolve({
      meta: dictionaryMeta,
      phrase: parsePhrases(dslContent, dictLanguages)
    });
  });
};

// Exports
module.exports = {
  parse
};