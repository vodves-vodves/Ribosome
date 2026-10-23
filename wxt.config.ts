import { defineConfig } from 'wxt';
import { LOCALES } from './shared/locales';

export default defineConfig({
  manifest: {
    // the store takes its title from here, so the localized name carries the search word
    name: '__MSG_extName__',
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
    // the manifest name, description and the shortcut name are the only strings Chrome localizes by itself
    'build:publicAssets'(_, files) {
      for (const [lang, m] of Object.entries(LOCALES))
        files.push({
          relativeDest: `_locales/${lang}/messages.json`,
          contents: JSON.stringify({ extName: { message: m.extName }, extDescription: { message: m.extDescription }, cmdTogglePage: { message: m.cmdTogglePage } }),
        });
    },
  },
});
