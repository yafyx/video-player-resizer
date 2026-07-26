import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Player Resizer',
    description: 'Resize the video on any page by dragging its edges.',
    version: '1.1.0',
    permissions: ['storage'],
    // Needed both to run the content script everywhere and to let the popup
    // message it back.
    host_permissions: ['<all_urls>'],
  },
});
