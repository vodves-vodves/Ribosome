import { defineConfig } from 'wxt';
import { LOCALES } from './shared/locales';

export default defineConfig({
  manifest: {
    name: 'Ribosome',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // appearance: base-select for the popup dropdowns
    minimum_chrome_version: '135',
    permissions: ['storage'],
    host_permissions: ['https://translate.googleapis.com/*'],
  },
  hooks: {
    // the manifest description is the only string Chrome localizes by itself
    'build:publicAssets'(_, files) {
      for (const [lang, m] of Object.entries(LOCALES))
        files.push({ relativeDest: `_locales/${lang}/messages.json`, contents: JSON.stringify({ extDescription: { message: m.extDescription } }) });
    },
  },
});
