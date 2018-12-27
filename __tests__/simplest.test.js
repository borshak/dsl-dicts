const fs = require('fs');
const dslDicts = require('../src/main');

const dslContent = fs.readFileSync('./__tests__/__fixtures__/simplest.dsl', 'utf-8');

describe('First test', () => {
    it('DLS parsing test', async () => {
        const dict = await dslDicts.parse(dslContent);
        
        expect(dict.meta.name).toEqual('Simplest dictionary');
        expect(dict.meta.language.source).toEqual('English');
        expect(dict.meta.language.target).toEqual('Russian');

        expect(dict.phrase.next()).toEqual({
            done: false,
            value: [ 'The simples DSL dictionary', '    Простейший DSL-словарь' ]
        });

        expect(dict.phrase.next()).toEqual({
            done: false,
            value: [ 'i', '    я' ]
        });
    });    
});