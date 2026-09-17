import {
  observeVideoPlayers,
  findPlayers,
  isPlayerCandidate,
  describePlayer,
  describeElementTarget,
} from '../utils/videoDetector';
import type { DetectedPlayer } from '../utils/videoDetector';
import { createResizeOverlay } from '../utils/resize';
import type { ResizeOverlay } from '../utils/resize';
import { startElementPicker } from '../utils/picker';
import type { PickerSession } from '../utils/picker';
import { createControlToolbar } from '../utils/toolbar';
import type { ControlToolbar } from '../utils/toolbar';
import { computeElementPath, resolveElementPath, elementLabel } from '../utils/elementPath';
import {
  loadSettingsForSite,
  setSettings,
  setSiteEnabled,
  persistDimensions,
  clearDimensions,
  persistPick,
  clearSitePick,
  watchStorage,
} from '../utils/storage';
import type {
  ExtensionSettings,
  PickMode,
  SiteActivation,
  SiteOverrides,
  StoredDimensions,
  StoredPick,
} from '../utils/storage';
import type { ContentRequest, PlayerState, PlayerSummary } from '../utils/messages';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../utils/constants';

/**
 * A stored pick often points at markup the page has not rendered yet, so a miss
 * on the first try means "not yet", not "gone". These are the retries, in ms
 * after the previous one failed.
 */
const PICK_RESTORE_DELAYS = [250, 800, 2000, 4000];

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    const hostname = window.location.hostname;

    let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    let activation: SiteActivation = { active: false };
    let persisted: StoredDimensions | null = null;
    let overlay: ResizeOverlay | null = null;
    let watcher: ReturnType<typeof observeVideoPlayers> | null = null;
    let playerCount = 0;
    let torn = false;

    /** The manual target, when the user set one. It outranks everything detected. */
    let pick: { player: DetectedPlayer; mode: PickMode } | null = null;
    /** Its stored form, kept even while unresolved so a late render can still match. */
    let storedPick: StoredPick | null = null;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    let picker: PickerSession | null = null;
    let toolbar: ControlToolbar | null = null;
    let reopenToolbarAfterPicker = false;

    /** Last player detection put the overlay on. Only ever restored, never resized blind. */
    let lastAutoCore: HTMLElement | null = null;

    // Ids the control sheet can hand back to name an element. A WeakMap keeps them stable
    // for as long as the element lives without pinning it in memory.
    const playerIds = new WeakMap<HTMLElement, string>();
    let idSeq = 0;

    /** The global switch and the per-site decision both have to be on. */
    const active = () => settings.enabled && activation.active;

    // ---- Overlay lifecycle -------------------------------------------------

    function ensureOverlay(): ResizeOverlay {
      if (overlay) return overlay;

      overlay = createResizeOverlay(
        { lockAspectRatio: settings.lockAspectRatio, allowOverflow: settings.allowOverflow },
        {
          onCommit(width, height) {
            if (settings.rememberSize) {
              persisted = { width, height };
              void persistDimensions(hostname, persisted);
            }
            syncToolbar();
          },
          onReset() {
            persisted = null;
            void clearDimensions(hostname);
            syncToolbar();
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
      syncToolbar();
    }

    /** Detection's route to the overlay. A manual target closes it. */
    function mountDetected(player: DetectedPlayer): void {
      if (pick) return;
      lastAutoCore = player.core;
      mount(player);
    }

    function teardown(restore: boolean): void {
      if (!overlay) return;
      if (restore) overlay.restoreAll();
      overlay.detach();
      syncToolbar();
    }

    /** Put the overlay back on whatever should own it right now. */
    function remount(): void {
      if (!active()) return;

      if (pick) {
        mount(pick.player);
        return;
      }

      const current = watcher?.current();
      if (current?.core.isConnected) {
        mountDetected(describePlayer(current.core));
        return;
      }

      teardown(false);
      watcher?.recheck();
    }

    // ---- Manual target -----------------------------------------------------

    function applyPick(el: HTMLElement, mode: PickMode, persist: boolean): void {
      const describe = () =>
        mode === 'element' ? describeElementTarget(el) : describePlayer(el);

      // Everything we already sized goes back before the new target is measured,
      // for two reasons. A size of ours still on the page would be read as this
      // element's natural box; and the overlay caches one sizing chain per media
      // element, so a chain detection resolved earlier would win over the box the
      // user just pointed at. Being told which element was meant is also the one
      // moment where dropping a size is what they want.
      if (lastAutoCore) overlay?.restoreFor(lastAutoCore);
      overlay?.restoreFor(describe().core);
      lastAutoCore = null;

      const player = describe();
      pick = { player, mode };
      mount(player);

      if (!persist) return;

      const path = computeElementPath(el);
      storedPick = path ? { path, mode } : null;

      // No path means the element lives somewhere we cannot address on the next
      // visit -- a same-origin subframe. The pick still works for this page load.
      if (storedPick) void persistPick(hostname, storedPick);
      else void clearSitePick(hostname);
    }

    function dropPick(): void {
      const previous = pick;
      pick = null;
      storedPick = null;
      if (restoreTimer !== null) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      void clearSitePick(hostname);

      // Leaving the element stretched would strand a size the overlay is no
      // longer on, so it goes back before detection takes over again.
      if (previous) overlay?.restoreFor(previous.player.core);
      remount();
    }

    function tryRestorePick(): boolean {
      if (!storedPick || pick || torn || !active()) return false;
      const el = resolveElementPath(storedPick.path);
      if (!el) return false;
      applyPick(el, storedPick.mode, false);
      return true;
    }

    function scheduleRestore(attempt = 0): void {
      // Out of retries: the element is not coming back, so detection gets the
      // overlay rather than the page being left with nothing on it.
      if (attempt >= PICK_RESTORE_DELAYS.length) {
        remount();
        return;
      }

      if (restoreTimer !== null) clearTimeout(restoreTimer);

      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        if (tryRestorePick()) return;
        if (storedPick && !pick) scheduleRestore(attempt + 1);
        else remount();
      }, PICK_RESTORE_DELAYS[attempt]);
    }

    /** A re-render can take the picked node out; the path may still find its twin. */
    function verifyPick(): void {
      if (!pick || pick.player.target.isConnected) return;
      pick = null;
      teardown(false);
      scheduleRestore();
    }

    // ---- Element picker ----------------------------------------------------

    function startPicking(): void {
      if (!active() || picker) return;

      // The resize handles would sit on top of the picker and confuse both.
      reopenToolbarAfterPicker = toolbar?.isOpen() ?? false;
      if (reopenToolbarAfterPicker) toolbar?.hide({ restoreFocus: false });
      teardown(false);

      picker = startElementPicker({
        onPick(el) {
          picker = null;
          applyPick(el, 'element', true);
          restoreToolbarAfterPicker();
        },
        onCancel() {
          picker = null;
          remount();
          restoreToolbarAfterPicker();
        },
      });
    }

    /** Close the picker without treating it as a cancellation. */
    function stopPicking(): void {
      picker?.stop();
      picker = null;
    }

    function restoreToolbarAfterPicker(): void {
      if (!reopenToolbarAfterPicker) return;
      reopenToolbarAfterPicker = false;
      toolbar?.show(snapshot());
    }

    // ---- Detection ---------------------------------------------------------

    function startWatching(): void {
      if (watcher) return;
      watcher = observeVideoPlayers({
        onScan: verifyPick,
        onChange(player) {
          playerCount = findPlayers().length;
          mountDetected(player);
        },
        onLost() {
          playerCount = 0;
          if (!pick) teardown(false);
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
     *
     * A manual target switches this off: having said which element to resize, the
     * user should not have it taken away by moving the mouse.
     */
    function onPointerOver(event: PointerEvent): void {
      if (!active() || !watcher || pick || picker) return;
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
      storedPick = state.pick;
      overlay?.updateSettings({
        lockAspectRatio: settings.lockAspectRatio,
        allowOverflow: settings.allowOverflow,
      });
    }

    function applyActivation(): void {
      if (active()) {
        // Ahead of the watcher: a pick that resolves right away means detection
        // never gets to mount, and the page never flashes the wrong element.
        if (storedPick && !tryRestorePick()) scheduleRestore();
        startWatching();
        watcher?.recheck();
      } else {
        stopPicking();
        stopWatching();
        pick = null;
        lastAutoCore = null;
        teardown(true);
      }
      if (!picker) restoreToolbarAfterPicker();
      syncToolbar();
    }

    void refresh().then(applyActivation);

    // ---- SPA navigation ----------------------------------------------------

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      stopPicking();
      pick = null;
      lastAutoCore = null;
      teardown(false);
      void refresh().then(() => {
        stopWatching();
        // A route change can swap the palette out from under us.
        overlay?.refreshTheme();
        applyActivation();
      });
    });

    // ---- Storage sync (extension controls and other tabs) ------------------

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

    // ---- Control messaging -------------------------------------------------

    function playerId(el: HTMLElement): string {
      let id = playerIds.get(el);
      if (!id) {
        id = `p${++idSeq}`;
        playerIds.set(el, id);
      }
      return id;
    }

    function listPlayers(): PlayerSummary[] {
      const players = findPlayers();
      playerCount = players.length;

      const activeCore = overlay?.getPlayer()?.core ?? watcher?.current()?.core ?? null;

      return players.map((p) => ({
        id: playerId(p.core),
        label: elementLabel(p.core),
        kind: p.kind,
        width: p.naturalWidth,
        height: p.naturalHeight,
        active: p.core === activeCore,
      }));
    }

    function snapshot(): PlayerState {
      const players = listPlayers();
      const player = pick?.player ?? overlay?.getPlayer() ?? watcher?.current() ?? null;
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
        hostname,
        players,
        picking: !!picker,
        // Name what the user actually chose: the element for a picked box, the
        // media element for a player they clicked in the list -- not the wrapper
        // `resolveChain` happened to climb to.
        pickLabel: pick
          ? elementLabel(pick.mode === 'player' ? pick.player.core : pick.player.target)
          : null,
      };
    }

    function ensureToolbar(): ControlToolbar {
      if (!toolbar) {
        toolbar = createControlToolbar({
          iconUrl: browser.runtime.getURL('/icon/32.png'),
          dispatch: handle,
        });
      }
      return toolbar;
    }

    function syncToolbar(): void {
      toolbar?.update(snapshot());
    }

    async function handle(message: ContentRequest): Promise<PlayerState> {
      switch (message.type) {
        case 'toggleToolbar': {
          if (picker) {
            stopPicking();
            reopenToolbarAfterPicker = false;
            remount();
            ensureToolbar().show(snapshot());
          } else {
            ensureToolbar().toggle(snapshot());
          }
          break;
        }

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

        case 'startPicking': {
          startPicking();
          break;
        }

        case 'cancelPicking': {
          stopPicking();
          remount();
          restoreToolbarAfterPicker();
          break;
        }

        case 'selectPlayer': {
          const match = findPlayers().find((p) => playerId(p.core) === message.id);
          if (match) applyPick(match.core, 'player', true);
          break;
        }

        case 'clearPick': {
          dropPick();
          break;
        }

        case 'getState':
        default:
          break;
      }

      const state = snapshot();
      toolbar?.update(state);
      return state;
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
      stopPicking();
      stopWatching();
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      unwatchSettings();
      unwatchOverrides();
      overlay?.destroy();
      overlay = null;
      toolbar?.destroy();
      toolbar = null;
      browser.runtime.onMessage.removeListener(onMessage);
    });

    // Re-describe the active player after late layout shifts (fonts, lazy images)
    // so the natural size we remember is the settled one. A manual target is left
    // alone: its box is whatever the user pointed at.
    const settleTimer = setTimeout(() => {
      const current = watcher?.current();
      if (current && active() && !pick && !overlay?.isResized()) {
        mountDetected(describePlayer(current.core));
      }
    }, 1200);
    ctx.onInvalidated(() => clearTimeout(settleTimer));
  },
});
