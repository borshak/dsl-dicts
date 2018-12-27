// Imports
const ParseError = require('./ParseError');
const utils = require('./utils');

// Entry point
function *parsePhrases(dslContent) {
  let entityBeginIndex = utils.indexOfFirstLangEntity(dslContent);
  let entityEndIndex = utils.indexOfNextLangEntity(dslContent, entityBeginIndex);

  while (entityEndIndex !== -1) {
    const rawEntity = dslContent.substring(entityBeginIndex, entityEndIndex);
    const splitted = utils.splitByEndOfLine(rawEntity);
    const filtered = splitted.filter(str => !utils.isEmptyStr(str));
    yield filtered;

    entityBeginIndex = entityEndIndex;
    entityEndIndex = utils.indexOfNextLangEntity(dslContent, entityBeginIndex);
  }
};

// Exports
module.exports = parsePhrases;