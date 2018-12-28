const fs = require('fs');
const dslDicts = require('./src/main');

fs.readFile('./__tests__/__fixtures__/basic_en-ru.dsl', 'utf-8', (error, content) => {
  if (error) {
    console.log('ERROR:', error);
    return;
  }

  async function dictTraversing(content) {
    try {
      const dict = await dslDicts.parse(content);
      console.log('META:');
      console.log(dict.meta);

      for (const phrase of dict.phrase) {
        console.log(phrase);
      }
    } catch(error) {
      console.log('ERR:', error);
    }
  };

  dictTraversing(content);


  // dslDicts.parse(content)
  //   .then(function(dict) {

  //     // console.log(dictionary);

  //     // return;
  //     console.log('--');
  //     console.log(dict.meta);
  //     console.log('--');

  //     for (const phrase of dict.dictionary) {
  //       console.log(phrase);
  //     }

  //     // console.log(dict.dictionary.next());
  //   })
  //   .catch(function(error) {
  //     console.log('ERROR', error.message);
  //   });

});