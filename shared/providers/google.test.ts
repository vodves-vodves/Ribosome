import { expect, test } from 'vitest';
import sample from './gtx-sample.json';
import { parseGtx, parseGtxMany } from './google';

test('gtx parser joins sentences and returns the detected language', () => {
  expect(parseGtx(sample)).toEqual({
    text: 'Рибосома состоит из двух субъединиц. Небольшая субъединица расшифровывает сообщение.\nРибосомы древние.',
    detected: 'en',
  });
});

test('unexpected response is an error, not an empty translation', () => {
  expect(() => parseGtx({ error: 1 })).toThrow();
});

test('batch parser reads both answer shapes and rejects a short one', () => {
  expect(parseGtxMany([['Привет', 'en'], ['Мир', 'de']], 2, 'auto')).toEqual([
    { text: 'Привет', detected: 'en' },
    { text: 'Мир', detected: 'de' },
  ]);
  expect(parseGtxMany(['Добрый день'], 1, 'de')).toEqual([{ text: 'Добрый день', detected: 'de' }]);
  expect(() => parseGtxMany([['Привет', 'en']], 2, 'auto')).toThrow();
});
