import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Player Resizer',
    description: 'Resize any video player by dragging its edges.',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
  },
});