import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as dslDicts from '../../legacy/main.js';

const dslContent = readFileSync(
  fileURLToPath(new URL('../fixtures/legacy/simplest.dsl', import.meta.url)),
  'utf-8',
);

describe('Test of interface on simplest DSL', () => {
  it('DLS iteration test', async () => {
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

  it('DLS parsing test', async () => {
    const dict = await dslDicts.parse(dslContent);

    const firstEntity = dict.phrase.next(); // 'The simples DSL dictionary'

    expect(firstEntity.value).toBeDefined();
    expect(firstEntity.value.phrase).toBeDefined();
    expect(firstEntity.value.phrase).toEqual('The simples DSL dictionary');

    expect(firstEntity.value.explanations).toBeDefined();
    expect(firstEntity.value.explanations.length).toEqual(1);
    expect(firstEntity.value.explanations[0].translations).toBeDefined();
    expect(firstEntity.value.explanations[0].examples).not.toBeDefined();
    expect(firstEntity.value.explanations[0].translations[0]).toEqual('Простейший DSL-словарь');

    dict.phrase.next(); // 'i'

    const thirdEntity = dict.phrase.next(); // 'you'
    expect(thirdEntity.value).toBeDefined();
    expect(thirdEntity.value.phrase).toBeDefined();
    expect(thirdEntity.value.phrase).toEqual('you');

    expect(thirdEntity.value.explanations).toBeDefined();
    expect(thirdEntity.value.explanations.length).toEqual(1);
    expect(thirdEntity.value.explanations[0].translations).toBeDefined();
    expect(thirdEntity.value.explanations[0].examples).not.toBeDefined();
    expect(thirdEntity.value.explanations[0].translations[0]).toEqual('ты');
  });
});
