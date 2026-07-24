import { detectVideoPlayer, observeVideoPlayers } from '../utils/videoDetector';
import { createResizeHandles, applyDimensions, resetDimensions } from '../utils/resize';
import {
  loadSettingsForSite,
  setSettings,
  getSettings,
  persistDimensions,
  setSiteDisabled,
  watchStorage,
} from '../utils/storage';
import type { DetectedPlayer } from '../utils/videoDetector';
import type { ExtensionSettings } from '../utils/storage';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    let currentPlayer: DetectedPlayer | null = null;
    let currentSettings: ExtensionSettings = { enabled: true, lockAspectRatio: false };
    let resizeControls: { remove: () => void; update: (s: ExtensionSettings) => void } | null = null;
    let disconnected = false;
    let persistedDimensions: { width: number; height: number } | null = null;

    const hostname = window.location.hostname;

    // ---- Load initial settings ----
    async function refreshSettings() {
      const data = await loadSettingsForSite(hostname);
      currentSettings = {
        ...data.settings,
        enabled: data.settings.enabled && !data.disabled,
      };
      persistedDimensions = data.persistedDimensions;
    }

    await refreshSettings();

    // ---- Player detection + mount ----
    function mountHandles(player: DetectedPlayer) {
      if (disconnected || !currentSettings.enabled) return;

      if (resizeControls) {
        resizeControls.remove();
        resizeControls = null;
      }

      // Apply persisted dimensions if available
      if (persistedDimensions) {
        applyDimensions(player.element, persistedDimensions.width, persistedDimensions.height);
      }

      resizeControls = createResizeHandles(
        ctx,
        player.element,
        player.naturalWidth,
        player.naturalHeight,
        currentSettings,
        (w, h) => {
          persistDimensions(hostname, { width: w, height: h });
        },
      );

      currentPlayer = player;
    }

    function unmountHandles() {
      if (resizeControls) {
        resizeControls.remove();
        resizeControls = null;
      }
      if (currentPlayer) {
        resetDimensions(currentPlayer.element);
      }
      currentPlayer = null;
    }

    async function enableForSite() {
      currentSettings.enabled = true;
      await setSiteDisabled(hostname, false);
      await refreshSettings();
      if (currentPlayer) {
        mountHandles(currentPlayer);
      } else {
        tryDetect();
      }
    }

    async function disableForSite() {
      currentSettings.enabled = false;
      await setSiteDisabled(hostname, true);
      await refreshSettings();
      unmountHandles();
    }

    function tryDetect() {
      const player = detectVideoPlayer();
      if (player) {
        currentPlayer = player;
        mountHandles(player);
      }
    }

    tryDetect();

    // ---- SPA navigation handling ----
    ctx.addEventListener(window, 'wxt:locationchange', async () => {
      unmountHandles();
      await refreshSettings();
      tryDetect();
    });

    // ---- DOM mutation observer for dynamically-added players ----
    const stopObserving = observeVideoPlayers((player) => {
      if (!currentPlayer || player.element !== currentPlayer.element) {
        unmountHandles();
        currentPlayer = player;
        mountHandles(player);
      }
    });

    // ---- Reactive storage watchers ----
    const unwatchSettings = watchStorage<ExtensionSettings>('sync', 'settings', (newVal) => {
      if (newVal) {
        currentSettings = { ...newVal, enabled: newVal.enabled };
        if (resizeControls) {
          resizeControls.update(currentSettings);
        }
      }
    });

    const unwatchDimensions = watchStorage<Record<string, { width: number; height: number }>>(
      'local', 'siteDimensions', async () => {
        const data = await loadSettingsForSite(hostname);
        if (data.persistedDimensions && currentPlayer) {
          applyDimensions(currentPlayer.element, data.persistedDimensions.width, data.persistedDimensions.height);
        }
      },
    );

    const unwatchDisabled = watchStorage<Record<string, boolean>>('local', 'perSiteDisabled', async () => {
      await refreshSettings();
      if (!currentSettings.enabled && resizeControls) {
        unmountHandles();
      } else if (currentSettings.enabled && !resizeControls) {
        tryDetect();
      }
    });

    // ---- Popup messaging ----
    browser.runtime.onMessage.addListener(
      (message: any, _sender: browser.runtime.MessageSender) => {
        if (message?.type === 'getState') {
          const el = currentPlayer?.element;
          return Promise.resolve({
            type: 'state',
            playerDetected: !!currentPlayer,
            currentWidth: el?.offsetWidth ?? 0,
            currentHeight: el?.offsetHeight ?? 0,
            naturalWidth: currentPlayer?.naturalWidth ?? 0,
            naturalHeight: currentPlayer?.naturalHeight ?? 0,
            enabled: currentSettings.enabled,
            lockAspectRatio: currentSettings.lockAspectRatio,
          });
        }

        if (message?.type === 'toggleEnabled') {
          if (currentSettings.enabled) {
            return disableForSite().then(() => ({ type: 'toggled', enabled: false }));
          } else {
            return enableForSite().then(() => ({ type: 'toggled', enabled: true }));
          }
        }

        if (message?.type === 'toggleAspectRatio') {
          currentSettings.lockAspectRatio = !currentSettings.lockAspectRatio;
          return setSettings({ ...currentSettings }).then(() => {
            if (resizeControls) {
              resizeControls.update(currentSettings);
            }
            return { type: 'aspectRatioToggled', lockAspectRatio: currentSettings.lockAspectRatio };
          });
        }

        if (message?.type === 'applyPreset' && currentPlayer) {
          const scale = message.scale as number;
          const w = Math.round(currentPlayer.naturalWidth * scale);
          const h = Math.round(currentPlayer.naturalHeight * scale);
          applyDimensions(currentPlayer.element, w, h);
          return persistDimensions(hostname, { width: w, height: h }).then(() => ({
            type: 'presetApplied', width: w, height: h,
          }));
        }

        if (message?.type === 'resetSize' && currentPlayer) {
          resetDimensions(currentPlayer.element);
          return persistDimensions(hostname, {
            width: currentPlayer.naturalWidth,
            height: currentPlayer.naturalHeight,
          }).then(() => ({ type: 'sizeReset' }));
        }

        return Promise.resolve(null);
      },
    );

    // ---- Cleanup on invalidate ----
    ctx.onInvalidated(() => {
      disconnected = true;
      stopObserving();
      unwatchSettings();
      unwatchDimensions();
      unwatchDisabled();
      unmountHandles();
    });
  },
});