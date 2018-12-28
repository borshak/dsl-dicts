const fs = require('fs');
const dslDicts = require('../src/main');

const basicDslContent = fs.readFileSync('./__tests__/__fixtures__/basic_en-ru.dsl', 'utf-8');

describe('Test of parsing', () => {
    it('DLS parsing test', async () => {
        const basicDict = await dslDicts.parse(basicDslContent);
        
        expect(basicDict.meta.name).toEqual('Basic dictionary for tests');
        expect(basicDict.meta.language.source).toEqual('English');
        expect(basicDict.meta.language.target).toEqual('Russian');


        const firstEntity = basicDict.phrase.next(); // 'automatic'

        expect(firstEntity.value).toBeDefined();
        expect(firstEntity.value.phrase).toBeDefined();
        expect(firstEntity.value.phrase).toEqual('automatic');

        expect(firstEntity.value.explanations).toBeDefined();
        expect(firstEntity.value.explanations.length).toEqual(3);

        expect(firstEntity.value.explanations[0].translations).toBeDefined();
        expect(firstEntity.value.explanations[0].examples).toBeDefined();

        expect(firstEntity.value.explanations[0].translations[0]).toEqual('автоматический, автоматизированный');
        expect(firstEntity.value.explanations[0].translations[1]).toEqual('машинальный, непроизвольный');

        expect(firstEntity.value.explanations[0].examples.length).toEqual(1);
        expect(firstEntity.value.explanations[0].examples[0].English).toBeDefined();
        expect(firstEntity.value.explanations[0].examples[0].Russian).toBeDefined();

        expect(firstEntity.value.explanations[0].examples[0].English).toEqual('The winking of the eyes is essentially automatic.');
        expect(firstEntity.value.explanations[0].examples[0].Russian).toEqual('Глаза моргают непроизвольно.');

        expect(firstEntity.value.explanations[1].examples[0].English).toEqual('Failures of the automatics may be more dangerous than the human failures they are designed to prevent.');
        expect(firstEntity.value.explanations[1].examples[0].Russian).toEqual('Ошибки автоматов могут быть более опасными, чем человеческие ошибки, которые эти устройства должны предотвращать.');


        const secondEntity = basicDict.phrase.next(); // 'extra'

        expect(secondEntity.done).not.toEqual(true);
        expect(secondEntity.value).toBeDefined();
        expect(secondEntity.value.phrase).toBeDefined();
        expect(secondEntity.value.phrase).toEqual('extra');

        expect(secondEntity.value.explanations).toBeDefined();
        expect(secondEntity.value.explanations.length).toEqual(1);

        expect(secondEntity.value.explanations[0].translations).toBeDefined();
        expect(secondEntity.value.explanations[0].examples).not.toBeDefined();

        expect(secondEntity.value.explanations[0].translations[0]).toEqual('дополнительный; дополнительно; особо; добавочный; экстра; статист; экстренный');


        const thirdEntity = basicDict.phrase.next(); // 'money'

        expect(thirdEntity.value).toBeDefined();
        expect(thirdEntity.value.phrase).toBeDefined();
        expect(thirdEntity.value.phrase).toEqual('money');

        expect(thirdEntity.value.explanations).toBeDefined();
        expect(thirdEntity.value.explanations.length).toEqual(2);

        expect(thirdEntity.value.explanations[0].translations.length).toEqual(1);
        expect(thirdEntity.value.explanations[0].translations[0]).toEqual('употр. с гл. в ед. деньги');
        expect(thirdEntity.value.explanations[0].examples.length).toEqual(16);

        expect(thirdEntity.value.explanations[1].translations.length).toEqual(4);
        expect(thirdEntity.value.explanations[1].translations[0]).toEqual('платёжное средство');
        expect(thirdEntity.value.explanations[1].translations[3]).toEqual('(monies) юр. денежные суммы');

        expect(thirdEntity.value.explanations[1].examples.length).toEqual(2);

        expect(thirdEntity.value.explanations[1].examples[0].English).toBeDefined();
        expect(thirdEntity.value.explanations[1].examples[0].Russian).toBeDefined();
        expect(thirdEntity.value.explanations[1].examples[0].English).toEqual('He has money to burn.');
        expect(thirdEntity.value.explanations[1].examples[0].Russian).toEqual('У него денег куры не клюют.');

        expect(thirdEntity.value.explanations[1].examples[1].English).toBeDefined();
        expect(thirdEntity.value.explanations[1].examples[1].Russian).toBeDefined();
        expect(thirdEntity.value.explanations[1].examples[1].English).toEqual('Money makes money.');
        expect(thirdEntity.value.explanations[1].examples[1].Russian).toEqual(' посл. — Деньги к деньгам.');


        const fourthEntity = basicDict.phrase.next(); // 'province', the last one

        expect(fourthEntity.done).not.toEqual(true);
        expect(fourthEntity.value).toBeDefined();
        expect(fourthEntity.value.phrase).toBeDefined();
        expect(fourthEntity.value.phrase).toEqual('province');


        const fifthhEntity = basicDict.phrase.next(); // Iterator should be empty on this step

        expect(fifthhEntity.done).toEqual(true);
    });    
});