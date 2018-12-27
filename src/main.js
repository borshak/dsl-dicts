// imports
const ParseError = require('./ParseError');
const parseMeta = require('./parse-meta');
const parsePhrases = require('./parse-phrases');

// Entry point
const parse = dslContent => {
  return new Promise((resolve, reject) => {
    if (!dslContent) {
      reject(new ParseError());
    }

    resolve({
      meta: parseMeta(dslContent),
      phrase: parsePhrases(dslContent)
    });
  });
};

// Exports
module.exports = {
  parse
};