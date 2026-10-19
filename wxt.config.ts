import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Ribosome',
    description: 'Перевод выделенного текста прямо на странице',
    // appearance: base-select для списков в popup
    minimum_chrome_version: '135',
    permissions: ['storage'],
    host_permissions: ['https://translate.googleapis.com/*'],
  },
});
