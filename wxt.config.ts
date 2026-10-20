import { defineConfig } from 'wxt';
import { LOCALES } from './shared/locales';

export default defineConfig({
  manifest: {
    name: 'Ribosome',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // appearance: base-select for the popup dropdowns
    minimum_chrome_version: '135',
    permissions: ['storage', 'contextMenus'],
    host_permissions: ['https://translate.googleapis.com/*'],
    commands: {
      'toggle-page': { suggested_key: { default: 'Alt+T' }, description: '__MSG_cmdTogglePage__' },
    },
  },
  hooks: {
    // the manifest description and the shortcut name are the only strings Chrome localizes by itself
    'build:publicAssets'(_, files) {
      for (const [lang, m] of Object.entries(LOCALES))
        files.push({
          relativeDest: `_locales/${lang}/messages.json`,
          contents: JSON.stringify({ extDescription: { message: m.extDescription }, cmdTogglePage: { message: m.cmdTogglePage } }),
        });
    },
  },
});
