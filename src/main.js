// The very besic implementation

const os = require('os');

const isStartWithSpaceOrTab = str => str[0] === ' ' || str[0] === '\t';

const isStartWith = (str, subStr) => str.startsWith(subStr);

const isEmptyStr = str => str.trim().length === 0;

const extractMetaValue = str => str.split('"')[1];

const parse = (dslContent) => {
  const throwError = () => {
    throw new Error("Wrong DSL content. Can't parse data.");
  };

  if (!dslContent) throwError();

  const dictionary = {
    meta: {
      name: null,
      language: {
        source: null,
        target: null
      }
    },
    body: {}
  };


  // PARSING
  const lineByLine = dslContent.split(os.EOL);

  let entity;
  
  for (let i=0, max=lineByLine.length; i < max; i++) {
    
    const line = lineByLine[i];
    if (isStartWith(line, '#NAME')) {
      dictionary.meta.name = extractMetaValue(line);
    } else if (isStartWith(line, '#INDEX_LANGUAGE')) {
      dictionary.meta.language.source = extractMetaValue(line);
    } else if (isStartWith(line, '#CONTENTS_LANGUAGE')) {
      dictionary.meta.language.target = extractMetaValue(line);
    } else if (isEmptyStr(line)) {
      // do nothing for empty lines
    } else if (isStartWithSpaceOrTab(line)) {
      // translation
      dictionary.body[entity] += (!dictionary.body[entity] 
          ? line.trim() 
          : ` ${line.trim()}`);
    } else {
      // new phrase
      entity = line.trim();
      dictionary.body[entity] = dictionary.body[entity] || '';
    }
  }

  return dictionary;
};

// EXPORTS
module.exports = {
  parse
};