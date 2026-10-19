import type { Settings } from '../settings';
import { google } from './google';
import { withStub } from './stub';
import type { Provider } from './types';

export const providers: Record<Settings['provider'], Provider> = {
  google: import.meta.env.DEV ? withStub(google) : google,
};
