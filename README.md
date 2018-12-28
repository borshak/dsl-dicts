# dsl-dicts
NPM package to parsing DSL Dictionaries (Dictionary Specification Language, the format of dictionary files that was created by ABBYY company).

### Usage:

```js
const dslDicts = require('dsl-dicts');
const dictionary = dslDicts.parse(contentOfFileWithDslDictionary); // Returns promise

dictionary
  .then(dict => {
    // Dict meta information
    const dictName = dict.meta.name;
    const sourceLanguage = dict.meta.language.source;
    const targetLanguage = dict.meta.language.target;

    // Phrase iteration
    const phraseIterator = dict.phrase;
    
    // You can iterate manually...
    const nextPhrase = phraseIterator.next();

    // ...or in the for - of loop
    for (const phrase of phraseIterator) {
      console.log(phrase);
    }

    // Each 'phrase' (i.e. language entity) has format descibed below
  })
  .catch(error => {
    console.log('Some error occur', error);
  });
```

Format of the language entity

```js
const phrase = {
  phrase: "automatic", // the lang entity (the word, header of the card)
  transcription: "ˌɔːtə'mætɪk", // optional
  explanations:[
    {
      translations:
        [
          "автоматический, автоматизированный",
          "машинальный, непроизвольный"
        ],
      examples: // optional
        [
          {
            English: "The winking of the eyes is essentially automatic.",
            Russian: "Глаза моргают непроизвольно."
          }
        ]
    },
    {
      translations:
        [
          "автоматическое устройство; автомат"
        ],
      examples:
        [
          {
            English: "Failures of the automatics may be more dangerous than the human failures they are designed to prevent.",
            Russian:"Ошибки автоматов могут быть более опасными, чем человеческие ошибки, которые эти устройства должны предотвращать."
          }
        ]
      },
    {
      translations:
        [
          "автоматическое оружие",
          "автомобиль с автоматической коробкой передач"
        ]
    }
  ]
};
```

### Limitations

#### Card header
As for now headers handles "as is", without supporting ```{}```, ```()``` or any other [meta]symbols. I.e. the header ```walk(ing)``` will be handled just as ```walk(ing)```, but not as [```walk```, ```walking```].

#### Card body
As for now only transcription, translation(s) and example(s) supported. References and other advanced features of the DSL format not supported yet.

### License
MIT.