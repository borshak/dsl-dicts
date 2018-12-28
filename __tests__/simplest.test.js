const fs = require('fs');
const dslDicts = require('../src/main');

const dslContent = fs.readFileSync('./__tests__/__fixtures__/simplest.dsl', 'utf-8');

describe('Test of interface on simplest DSL', () => {
    it('DLS parsing test', async () => {
        const dict = await dslDicts.parse(dslContent);
        
        expect(dict.meta.name).toEqual('Simplest dictionary');
        expect(dict.meta.language.source).toEqual('English');
        expect(dict.meta.language.target).toEqual('Russian');

        // Simplest DSL contains 8
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(false);
        expect(dict.phrase.next().done).toEqual(true);
    });    
});