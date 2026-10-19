import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ProviderError, type Provider } from './providers/types';
import { createLimiter, createTranslator, type Acquire, type Cache } from './translator';

const memCache = (): Cache => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
};

const fake = (impl?: (text: string, from: string, to: string) => { text: string; detected: string }) => {
  const calls: { text: string; from: string; to: string; at: number }[] = [];
  const p: Provider = {
    id: 'fake',
    translate: async (text, from, to) => {
      calls.push({ text, from, to, at: Date.now() });
      return impl ? impl(text, from, to) : { text: `${to}:${text}`, detected: 'en' };
    },
  };
  return { p, calls };
};

// лимитер нужен только в своём тесте, остальным он мешает фейковыми таймерами
const setup = (p: Provider, secondary = 'en', acquire: Acquire = async () => {}) =>
  createTranslator({ provider: () => p, secondary: () => secondary, cache: memCache(), acquire });
const never = new AbortController().signal;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('лимитер: 30 запросов подряд — не больше 20 за 10 с, ни один не потерян и не продублирован', async () => {
  const { p, calls } = fake();
  const t = setup(p, 'en', createLimiter());
  const queued: number[] = [];
  const all = Promise.all(Array.from({ length: 30 }, (_, i) => t.translate({ text: `text ${i}`, from: 'auto', to: 'ru' }, never, () => queued.push(i))));
  await vi.advanceTimersByTimeAsync(30_000);
  const res = await all;

  expect(res.every((r) => r.ok)).toBe(true);
  expect(calls.map((c) => c.text).sort()).toEqual(Array.from({ length: 30 }, (_, i) => `text ${i}`).sort());
  for (const c of calls) expect(calls.filter((x) => x.at > c.at - 10_000 && x.at <= c.at).length).toBeLessThanOrEqual(20);
  for (let i = 1; i < calls.length; i++) expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(250);
  expect(queued.length).toBeGreaterThan(0);
});

test('кэш и дедуп: одинаковый текст — один запрос', async () => {
  const { p, calls } = fake();
  const t = setup(p);
  const req = { text: 'hello', from: 'auto', to: 'ru' };
  const [a, b] = await Promise.all([t.translate(req, never, () => {}), t.translate(req, never, () => {})]);
  const c = await t.translate(req, never, () => {});
  expect(calls).toHaveLength(1);
  expect(a).toMatchObject({ ok: true, cached: false });
  expect(b).toMatchObject({ ok: true, cached: false });
  expect(c).toMatchObject({ ok: true, cached: true });
});

test('отмена одного из ждущих не отменяет запрос для второго', async () => {
  const calls: string[] = [];
  const p: Provider = {
    id: 'slow',
    translate: (text, _from, to) => {
      calls.push(text);
      return new Promise((r) => setTimeout(() => r({ text: `${to}:${text}`, detected: 'en' }), 1000));
    },
  };
  const t = setup(p);
  const req = { text: 'hello', from: 'auto', to: 'ru' };
  const ctrl = new AbortController();
  const a = t.translate(req, ctrl.signal, () => {});
  const b = t.translate(req, never, () => {});
  await vi.advanceTimersByTimeAsync(0); // оба ждут один запрос
  ctrl.abort();
  await expect(a).rejects.toBeDefined();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(b).resolves.toMatchObject({ ok: true, text: 'ru:hello' });
  expect(calls).toHaveLength(1);
});

test('второй язык: текст уже на языке перевода', async () => {
  const { p, calls } = fake((text, _from, to) => ({ text: `${to}:${text}`, detected: 'ru' }));
  const t = setup(p, 'en');
  const r = await t.translate({ text: 'Рибосомы древние.', from: 'auto', to: 'ru' }, never, () => {});
  expect(r).toMatchObject({ ok: true, to: 'en', detected: 'ru', text: 'en:Рибосомы древние.' });
  expect(calls.map((c) => [c.from, c.to])).toEqual([['auto', 'ru'], ['ru', 'en']]);
});

test('без букв — nothing без запроса; длинный текст обрезается', async () => {
  const { p, calls } = fake();
  const t = setup(p);
  expect(await t.translate({ text: ' 12 345 — … ', from: 'auto', to: 'ru' }, never, () => {})).toEqual({ ok: false, error: 'nothing' });
  expect(calls).toHaveLength(0);
  const r = await t.translate({ text: 'a'.repeat(6000), from: 'auto', to: 'ru' }, never, () => {});
  expect(r).toMatchObject({ ok: true, truncated: true });
  expect(calls[0]!.text).toHaveLength(5000);
});

test('backoff на 429: пауза 2 с, в паузе запросы не уходят, после успеха сброс', async () => {
  let limited = true;
  const { p, calls } = fake((text, _f, to) => {
    if (limited) throw new ProviderError('rate_limited', 429);
    return { text: `${to}:${text}`, detected: 'en' };
  });
  const t = setup(p);
  expect(await t.translate({ text: 'a', from: 'auto', to: 'ru' }, never, () => {})).toEqual({ ok: false, error: 'rate_limited', retryAfter: 2 });
  expect(await t.translate({ text: 'b', from: 'auto', to: 'ru' }, never, () => {})).toMatchObject({ error: 'rate_limited' });
  expect(calls).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(2000);
  expect(await t.translate({ text: 'c', from: 'auto', to: 'ru' }, never, () => {})).toMatchObject({ error: 'rate_limited', retryAfter: 4 });

  await vi.advanceTimersByTimeAsync(4000);
  limited = false;
  expect(await t.translate({ text: 'd', from: 'auto', to: 'ru' }, never, () => {})).toMatchObject({ ok: true });
  limited = true;
  expect(await t.translate({ text: 'e', from: 'auto', to: 'ru' }, never, () => {})).toMatchObject({ retryAfter: 2 });
});

test('ошибки: 5xx — server со статусом, сбой fetch — offline', async () => {
  const t1 = setup(fake(() => { throw new ProviderError('server', 503); }).p);
  expect(await t1.translate({ text: 'a', from: 'auto', to: 'ru' }, never, () => {})).toEqual({ ok: false, error: 'server', status: 503 });
  const t2 = setup(fake(() => { throw new TypeError('Failed to fetch'); }).p);
  expect(await t2.translate({ text: 'a', from: 'auto', to: 'ru' }, never, () => {})).toEqual({ ok: false, error: 'offline' });
});
