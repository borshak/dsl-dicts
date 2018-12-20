# dsl-dicts
NPM package to work with DSL Dictionaries (Dictionary Specification Language, the format of dictionary files that was created by ABBYY company).

*!!! The very basic implementation. Will be change shortly.*

### Usage:

```js
const dslDicts = require('dsl-dicts');
const dictionary = dslDicts.parse(contentOfFileWithDslDictionary); 
```

The result of parsing will have such form:

```js
  const dictionary = {
    meta: {
      name: 'My DSL dictionary',
      language: {
        source: 'English',
        target: 'Spanish'
      }
    },
    body: {
      'hello': 'hola',
      'you': 'tu'
      ...
    }
  };
  ```