import { expect, test } from 'vitest';
import sample from './gtx-sample.json';
import { parseGtx } from './google';

test('gtx parser joins sentences and returns the detected language', () => {
  expect(parseGtx(sample)).toEqual({
    text: 'Рибосома состоит из двух субъединиц. Небольшая субъединица расшифровывает сообщение.\nРибосомы древние.',
    detected: 'en',
  });
});

test('unexpected response is an error, not an empty translation', () => {
  expect(() => parseGtx({ error: 1 })).toThrow();
});
