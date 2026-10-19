import { expect, test } from 'vitest';
import sample from './gtx-sample.json';
import { parseGtx } from './google';

test('парсер gtx склеивает предложения и отдаёт определённый язык', () => {
  expect(parseGtx(sample)).toEqual({
    text: 'Рибосома состоит из двух субъединиц. Небольшая субъединица расшифровывает сообщение.\nРибосомы древние.',
    detected: 'en',
  });
});

test('неожиданный ответ — ошибка, а не пустой перевод', () => {
  expect(() => parseGtx({ error: 1 })).toThrow();
});
