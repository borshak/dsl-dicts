const fs = require('fs');
const dslDicts = require('../src/main');

const dslContent = fs.readFileSync('./__tests__/__fixtures__/simplest.dsl', 'utf-8');
const dictionary = dslDicts.parse(dslContent);

describe('First test', () => {
    it('DLS parsing test', () => {
        expect(dictionary.meta.name).toEqual('Simplest dictionary');
        expect(dictionary.meta.language.source).toEqual('English');
        expect(dictionary.meta.language.target).toEqual('Russian');

        expect(dictionary.body['hello']).toBeDefined();
        expect(dictionary.body['hello']).not.toEqual('');
        expect(dictionary.body['hello']).toEqual('sey hello!');

        expect(dictionary.body['horror']).not.toBeDefined();
    });    
});