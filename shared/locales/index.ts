import en from './en';
import ru from './ru';

/** A new language is a file next to en.ts plus a line here. */
export const LOCALES: Record<string, Record<keyof typeof en, string>> = { en, ru };
