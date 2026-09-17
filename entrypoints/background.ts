import { getSettings, setSettings } from '../utils/storage';
import type { ContentRequest } from '../utils/messages';

export default defineBackground(() => {
  // A popup entrypoint would make the browser open its own floating window and
  // suppress this event. Keep the action page-less: a click talks straight to
  // the content script, which owns the visible control sheet.
  browser.action.onClicked.addListener((tab) => {
    if (tab.id == null) return;

    const message: ContentRequest = { type: 'toggleToolbar' };
    void browser.tabs.sendMessage(tab.id, message).catch(() => {
      // Restricted pages and tabs loaded before an extension reload cannot host
      // the in-page controls. A normal-page reload restores the content script.
    });
  });

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== 'install' && details.reason !== 'update') return;
    // `getSettings` merges over the defaults, so writing the result back is what
    // fills in any field added since the previous version.
    await setSettings(await getSettings());
  });
});
