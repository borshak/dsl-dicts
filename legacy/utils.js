// Imports
const os = require('os');

/**
 * Predicate, returns true if string starts with space or tab
 * @param {string} str
 * @returns {boolean}
 */
const isStartWithSpaceOrTab = str => str[0] === ' ' || str[0] === '\t';

/**
 * Predicate, returns true if string (str) starts with given substring (subStr)
 * @param {string} str 
 * @param {string} subStr
 * @returns {boolean}
 */
const isStartWith = (str, subStr) => str.startsWith(subStr);

/**
 * Predicate, returns true if string is empty one
 * @param {string} str
 * @returns {boolean} 
 */
const isEmptyStr = str => str.trim().length === 0;

/**
 * Returns array with string, that was splitted by new line character
 * @param {string} str
 * @returns {array} 
 */
const splitByEndOfLine = str => str.split(os.EOL);


/**
 * Returns index of firts Language Entity in the string with DSL dictionary
 * otherwise returns -1 if none of lang entity present
 * @param {string} dslContent
 * @returns {integer} index
 */
const indexOfFirstLangEntity = (dslContent) => {
  const isBeginOfLengEntity = (dslContent, currentPosition) => {
    return currentPosition > 0 
      && dslContent[currentPosition] !== '#'
      && dslContent[currentPosition] !== os.EOL
      && dslContent[currentPosition - 1] === os.EOL;
  };

  for (let i=0, len=dslContent.length; i < len; i++) {
    if (isBeginOfLengEntity(dslContent, i)) return i;
  }

  return -1;
};

/**
 * Returns index of next Language Entity in the string with DSL dictionary
 * otherwise returns -1 if next of lang entity not present
 * @param {string} dslContent
 * @param {integer} startPosition
 * @returns {integer} index
 */
const indexOfNextLangEntity = (dslContent, startPosition) => {

  const ENTITY_STATE = {
    HEADER: 'HEADER',
    BODY: 'BODY'
  };

  const isHeaderState = currentState => currentState === ENTITY_STATE.HEADER;
  const isBodyState = currentState => currentState === ENTITY_STATE.BODY;

  const isNewLineChar = char => char === os.EOL;
  const isSpaceOrTabChar = char => char === ' ' || char === '\t';
  const isValidHeaderChar = char => !isNewLineChar(char) && !isSpaceOrTabChar(char) && char !== '#';

  const isHeaderLineStart = (dslContent, currentPosition) => {
    const prevChar = dslContent[currentPosition - 1];
    const currentChar = dslContent[currentPosition];
    return isNewLineChar(prevChar) && isValidHeaderChar(currentChar);
  };

  const isBodyLineStart = (dslContent, currentPosition) => {
    const prevChar = dslContent[currentPosition - 1];
    const currentChar = dslContent[currentPosition];
    return isNewLineChar(prevChar) && isSpaceOrTabChar(currentChar);
  };

  let currentState = ENTITY_STATE.HEADER;

  for (let i=startPosition, len=dslContent.length; i < len; i++) {
    if (isHeaderState(currentState) && isBodyLineStart(dslContent, i)) {
      currentState = ENTITY_STATE.BODY;
    } else if (isBodyState(currentState) && isHeaderLineStart(dslContent, i)) {
      return i;
    }
  }

  if (isBodyState(currentState) && dslContent.length > startPosition) return dslContent.length;

  return -1;
};

// Exports
module.exports = {
  isStartWithSpaceOrTab,
  isStartWith,
  isEmptyStr,
  splitByEndOfLine,
  indexOfFirstLangEntity,
  indexOfNextLangEntity
};