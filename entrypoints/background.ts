import { getSettings, setSettings } from '../utils/storage';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== 'install' && details.reason !== 'update') return;
    // `getSettings` merges over the defaults, so writing the result back is what
    // fills in any field added since the previous version.
    await setSettings(await getSettings());
  });
});
