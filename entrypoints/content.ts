import {
  observeVideoPlayers,
  findPlayers,
  isPlayerCandidate,
  describePlayer,
} from '../utils/videoDetector';
import type { DetectedPlayer } from '../utils/videoDetector';
import { createResizeOverlay } from '../utils/resize';
import type { ResizeOverlay } from '../utils/resize';
import {
  loadSettingsForSite,
  setSettings,
  setSiteEnabled,
  persistDimensions,
  clearDimensions,
  watchStorage,
} from '../utils/storage';
import type {
  ExtensionSettings,
  SiteActivation,
  SiteOverrides,
  StoredDimensions,
} from '../utils/storage';
import type { ContentRequest, PlayerState } from '../utils/messages';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../utils/constants';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    const hostname = window.location.hostname;

    let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    let activation: SiteActivation = { active: true, byDefault: false };
    let persisted: StoredDimensions | null = null;
    let overlay: ResizeOverlay | null = null;
    let watcher: ReturnType<typeof observeVideoPlayers> | null = null;
    let playerCount = 0;
    let torn = false;

    /** The global switch and the per-site decision both have to be on. */
    const active = () => settings.enabled && activation.active;

    // ---- Overlay lifecycle -------------------------------------------------

    function ensureOverlay(): ResizeOverlay {
      if (overlay) return overlay;

      overlay = createResizeOverlay(
        { lockAspectRatio: settings.lockAspectRatio, allowOverflow: settings.allowOverflow },
        {
          onCommit(width, height) {
            if (!settings.rememberSize) return;
            persisted = { width, height };
            void persistDimensions(hostname, persisted);
          },
          onReset() {
            persisted = null;
            void clearDimensions(hostname);
          },
        },
      );

      return overlay;
    }

    function mount(player: DetectedPlayer): void {
      if (torn || !active()) return;
      const view = ensureOverlay();
      view.attach(player);

      // Only re-apply a remembered size to a player we have not touched yet.
      if (settings.rememberSize && persisted && !view.isResized()) {
        view.setSize(persisted.width, persisted.height);
      }
    }

    function teardown(restore: boolean): void {
      if (!overlay) return;
      if (restore) overlay.restoreAll();
      overlay.detach();
    }

    // ---- Detection ---------------------------------------------------------

    function startWatching(): void {
      if (watcher) return;
      watcher = observeVideoPlayers({
        onChange(player) {
          playerCount = findPlayers().length;
          mount(player);
        },
        onLost() {
          playerCount = 0;
          teardown(false);
        },
      });
    }

    function stopWatching(): void {
      watcher?.stop();
      watcher = null;
    }

    /**
     * With several videos on a page, whichever one the pointer is over is the one
     * the user means. Scoring alone would keep the overlay pinned to the largest.
     */
    function onPointerOver(event: PointerEvent): void {
      if (!active() || !watcher) return;
      const node = event.target;
      if (!(node instanceof Element)) return;

      const media = node.closest('video, iframe') as HTMLElement | null;
      if (!media || media === watcher.current()?.core) return;
      if (!isPlayerCandidate(media)) return;

      watcher.select(media);
    }

    ctx.addEventListener(document, 'pointerover', onPointerOver, { capture: true });

    // ---- Boot --------------------------------------------------------------

    async function refresh(): Promise<void> {
      const state = await loadSettingsForSite(hostname);
      settings = state.settings;
      activation = state.activation;
      persisted = state.persistedDimensions;
      overlay?.updateSettings({
        lockAspectRatio: settings.lockAspectRatio,
        allowOverflow: settings.allowOverflow,
      });
    }

    function applyActivation(): void {
      if (active()) {
        startWatching();
        watcher?.recheck();
      } else {
        stopWatching();
        teardown(true);
      }
    }

    void refresh().then(applyActivation);

    // ---- SPA navigation ----------------------------------------------------

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      teardown(false);
      void refresh().then(() => {
        stopWatching();
        // A route change can swap the palette out from under us.
        overlay?.refreshTheme();
        applyActivation();
      });
    });

    // ---- Storage sync (popup and other tabs) -------------------------------

    const unwatchSettings = watchStorage<ExtensionSettings>('sync', 'settings', () => {
      void refresh().then(applyActivation);
    });

    const unwatchOverrides = watchStorage<SiteOverrides>(
      'local',
      STORAGE_KEYS.PER_SITE_OVERRIDES,
      () => {
        void refresh().then(applyActivation);
      },
    );

    // ---- Popup messaging ---------------------------------------------------

    function snapshot(): PlayerState {
      const player = overlay?.getPlayer() ?? watcher?.current() ?? null;
      const size = overlay?.getSize() ?? null;

      return {
        type: 'state',
        playerDetected: !!player,
        playerCount,
        playerKind: player?.kind ?? null,
        isResized: overlay?.isResized() ?? false,
        currentWidth: size?.width ?? player?.naturalWidth ?? 0,
        currentHeight: size?.height ?? player?.naturalHeight ?? 0,
        naturalWidth: player?.naturalWidth ?? 0,
        naturalHeight: player?.naturalHeight ?? 0,
        settings,
        activeHere: activation.active,
        offByDefault: activation.byDefault,
        hostname,
      };
    }

    async function handle(message: ContentRequest): Promise<PlayerState> {
      switch (message.type) {
        case 'setEnabled': {
          await setSiteEnabled(hostname, message.value);
          await refresh();
          applyActivation();
          break;
        }

        case 'setSetting': {
          const patch: Partial<ExtensionSettings> = {};
          patch[message.key] = message.value;
          settings = await setSettings(patch);
          overlay?.updateSettings({
            lockAspectRatio: settings.lockAspectRatio,
            allowOverflow: settings.allowOverflow,
          });
          if (message.key === 'enabled') applyActivation();
          break;
        }

        case 'applyPreset': {
          const player = overlay?.getPlayer();
          if (player && overlay) {
            const width = Math.round(player.naturalWidth * message.scale);
            const height = Math.round(player.naturalHeight * message.scale);
            overlay.setSize(width, height);
            if (settings.rememberSize) {
              persisted = { width, height };
              await persistDimensions(hostname, persisted);
            }
          }
          break;
        }

        case 'setSize': {
          if (overlay) {
            overlay.setSize(message.width, message.height);
            if (settings.rememberSize) {
              persisted = { width: message.width, height: message.height };
              await persistDimensions(hostname, persisted);
            }
          }
          break;
        }

        case 'resetSize': {
          overlay?.resetSize();
          break;
        }

        case 'cyclePlayer': {
          const players = findPlayers();
          playerCount = players.length;
          if (players.length > 1 && watcher) {
            const currentCore = watcher.current()?.core;
            const index = players.findIndex((p) => p.core === currentCore);
            const next = players[(index + 1) % players.length];
            watcher.select(next.core);
          }
          break;
        }

        case 'getState':
        default:
          playerCount = findPlayers().length;
          break;
      }

      return snapshot();
    }

    // `sendResponse` + `return true` is the one shape that works on both the
    // promise-based polyfill and raw MV3 `chrome.runtime`.
    const onMessage = (
      message: ContentRequest,
      _sender: unknown,
      sendResponse: (response: PlayerState) => void,
    ): true => {
      handle(message).then(sendResponse, () => sendResponse(snapshot()));
      return true;
    };

    browser.runtime.onMessage.addListener(onMessage);

    // ---- Cleanup -----------------------------------------------------------

    ctx.onInvalidated(() => {
      torn = true;
      stopWatching();
      unwatchSettings();
      unwatchOverrides();
      overlay?.destroy();
      overlay = null;
      browser.runtime.onMessage.removeListener(onMessage);
    });

    // Re-describe the active player after late layout shifts (fonts, lazy images)
    // so the natural size we remember is the settled one.
    const settleTimer = setTimeout(() => {
      const current = watcher?.current();
      if (current && active() && !overlay?.isResized()) {
        mount(describePlayer(current.core));
      }
    }, 1200);
    ctx.onInvalidated(() => clearTimeout(settleTimer));
  },
});
