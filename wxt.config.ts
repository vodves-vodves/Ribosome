import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Ribosome',
    description: 'Перевод выделенного текста прямо на странице',
    // appearance: base-select for the popup dropdowns
    minimum_chrome_version: '135',
    permissions: ['storage'],
    host_permissions: ['https://translate.googleapis.com/*'],
  },
});
