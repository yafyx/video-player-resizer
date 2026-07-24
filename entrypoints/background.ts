import { getSettings, setSettings } from '../utils/storage';
import { DEFAULT_SETTINGS } from '../utils/constants';

export default defineBackground(() => {
  console.log('[VidResize] Background started');

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('[VidResize] First install — setting defaults');
      const existing = await getSettings();
      if (!existing || Object.keys(existing).length === 0) {
        await setSettings({ ...DEFAULT_SETTINGS });
      }
    }
    if (details.reason === 'update') {
      console.log('[VidResize] Updated');
    }
  });
});