// Imports
const ParseError = require('./ParseError');
const utils = require('./utils');

// Entry point
const parseMeta = dslContent => {
  const extractMetaValue = str => str.split('"')[1];

  const isMetaSetCorrectly = meta => (meta 
    && meta.name 
    && meta.language 
    && meta.language.source
    && meta.language.target);

  const startIndexOfFirstEntity = utils.indexOfFirstLangEntity(dslContent);

  if (startIndexOfFirstEntity === -1) throw new ParseError("Can't find DSL metadata.");

  const rawMeta = dslContent.substring(0, startIndexOfFirstEntity);
  const splittedMeta = utils.splitByEndOfLine(rawMeta);
  const filteredMeta = splittedMeta.filter(str => !utils.isEmptyStr(str));

  const meta = {
    name: null,
    language: {
      source: null,
      target: null
    }
  };

  filteredMeta.forEach(metaEntry => {
    switch (true) {
      case utils.isStartWith(metaEntry, '#NAME'):
        meta.name = extractMetaValue(metaEntry);
        break;

      case utils.isStartWith(metaEntry, '#INDEX_LANGUAGE'):
        meta.language.source = extractMetaValue(metaEntry);
        break;

      case utils.isStartWith(metaEntry, '#CONTENTS_LANGUAGE'):
        meta.language.target = extractMetaValue(metaEntry);
        break;

      default:
        break;
    }
  });

  if (!isMetaSetCorrectly(meta)) throw new ParseError("Wrong or incomplete DSL metadata.");

  return meta;
};

// Exports
module.exports = parseMeta;