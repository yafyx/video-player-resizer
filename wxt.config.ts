import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Player Resizer',
    description: 'Resize the video on any page by dragging its edges.',
    version: '1.1.0',
    permissions: ['storage'],
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
    web_accessible_resources: [
      {
        resources: ['icon/32.png'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
