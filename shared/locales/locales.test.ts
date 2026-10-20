import { expect, test } from 'vitest';
import en from './en';
import { LOCALES } from '.';

const subs = (s: string) => s.match(/\$\d/g)?.sort() ?? [];

test('every locale keeps the $N substitutions of English', () => {
  for (const m of Object.values(LOCALES)) for (const k of Object.keys(en) as (keyof typeof en)[]) expect(subs(m[k]), k).toEqual(subs(en[k]));
});
