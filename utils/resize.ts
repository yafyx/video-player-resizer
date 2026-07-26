import {
  HANDLE_POSITIONS,
  CORNER_HANDLES,
  HANDLE_AXES,
  HANDLE_LABELS,
  RESIZE_CURSORS,
  MIN_WIDTH,
  MIN_HEIGHT,
  SNAP_THRESHOLD,
  OVERLAY_HOST_ID,
} from './constants';
import type { HandlePosition } from './constants';
import { OVERLAY_CSS } from './overlayStyles';
import { createSizingSession } from './sizing';
import type { SizingSession } from './sizing';
import { deriveOverlayTheme } from './theme';
import type { OverlayTheme } from './theme';
import type { DetectedPlayer } from './videoDetector';

export interface OverlaySettings {
  lockAspectRatio: boolean;
  allowOverflow: boolean;
}

export interface ResizeOverlayCallbacks {
  /** Fired once a drag or keyboard adjustment settles. */
  onCommit: (width: number, height: number) => void;
  /** Fired on every frame of a drag. */
  onLive?: (width: number, height: number) => void;
  /** Fired when the player is put back to its original size. */
  onReset?: () => void;
}

export interface ResizeOverlay {
  attach: (player: DetectedPlayer) => void;
  /** Hides the overlay but leaves applied sizes in place. */
  detach: () => void;
  /** Puts every player on the page back to its original size. */
  restoreAll: () => void;
  destroy: () => void;
  updateSettings: (settings: OverlaySettings) => void;
  setSize: (width: number, height: number) => void;
  resetSize: () => void;
  getSize: () => { width: number; height: number } | null;
  getPlayer: () => DetectedPlayer | null;
  /** True when the active player is currently resized away from its natural box. */
  isResized: () => boolean;
  /** Re-read the page's palette. Worth doing after a SPA route change. */
  refreshTheme: () => OverlayTheme | null;
}

interface DragState {
  pointerId: number;
  handle: HandlePosition;
  handleEl: HTMLElement;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  ratio: number;
}

/** Grace period so moving from the video onto a handle does not flicker. */
const HIDE_DELAY_MS = 140;
const READOUT_LINGER_MS = 700;
const KEY_COMMIT_DELAY_MS = 450;
const KEY_STEP = 24;
const KEY_STEP_FINE = 4;

export function createResizeOverlay(
  initialSettings: OverlaySettings,
  callbacks: ResizeOverlayCallbacks,
): ResizeOverlay {
  let settings = { ...initialSettings };
  let player: DetectedPlayer | null = null;
  let sizing: SizingSession | null = null;
  let size: { width: number; height: number } | null = null;

  /**
   * Sizes are per media element and survive switching between players on the
   * same page -- hovering a second video must not silently undo the first one.
   * `naturals` caches each player's pre-resize box, because re-measuring after a
   * resize would treat our own value as the original.
   */
  const sessions = new Map<HTMLElement, SizingSession>();
  const naturals = new Map<HTMLElement, { width: number; height: number }>();

  let visible = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let readoutTimer: ReturnType<typeof setTimeout> | null = null;
  let keyCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;
  let hoverRafPending = false;
  let destroyed = false;

  let drag: DragState | null = null;
  let pendingPointer: { x: number; y: number; shift: boolean; alt: boolean } | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let dragRaf: number | null = null;
  let savedUserSelect: { value: string; priority: string } | null = null;

  // ---- Shadow tree -------------------------------------------------------

  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  // Belt and braces: a page rule like `div { display: none !important }` would
  // otherwise take out our host before the shadow styles ever apply.
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  // Colour probe. Lives in the shadow tree so the page cannot style it, and is
  // what lets `theme.ts` hand any CSS colour notation to the engine to resolve.
  const probe = document.createElement('div');
  probe.className = 'probe';
  shadow.appendChild(probe);

  const frame = document.createElement('div');
  frame.className = 'frame';
  frame.dataset.visible = 'false';
  frame.dataset.dragging = 'false';
  frame.dataset.readout = 'false';

  // Named `visual`, not `chrome`, so it cannot shadow the extension global.
  const visual = document.createElement('div');
  visual.className = 'chrome';

  const outline = document.createElement('div');
  outline.className = 'outline';
  visual.appendChild(outline);

  for (const pos of HANDLE_POSITIONS) {
    const el = document.createElement('div');
    const isCorner = CORNER_HANDLES.includes(pos);
    const isHorizontalEdge = pos === 't' || pos === 'b';
    el.className = `handle ${isCorner ? 'corner' : isHorizontalEdge ? 'edge-h' : 'edge-v'}`;
    el.dataset.handle = pos;
    el.dataset.grabbed = 'false';
    el.style.cursor = RESIZE_CURSORS[pos];
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Resize video from the ${HANDLE_LABELS[pos]}`);

    const { top, left } = getHandleAnchor(pos);
    el.style.top = top;
    el.style.left = left;

    el.addEventListener('pointerdown', (e) => onHandlePointerDown(e, pos, el));
    el.addEventListener('keydown', onHandleKeyDown);
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetSize();
    });
    el.addEventListener('focus', show);
    el.addEventListener('blur', hideSoon);

    visual.appendChild(el);
  }

  const readout = document.createElement('div');
  readout.className = 'readout';
  const readoutW = document.createElement('span');
  const readoutTimes = document.createElement('span');
  readoutTimes.className = 'times';
  readoutTimes.textContent = '×';
  const readoutH = document.createElement('span');
  const readoutScale = document.createElement('span');
  readoutScale.className = 'scale';
  readout.append(readoutW, readoutTimes, readoutH, readoutScale);
  visual.appendChild(readout);

  frame.appendChild(visual);
  shadow.appendChild(frame);

  const shield = document.createElement('div');
  shield.className = 'shield';
  shield.dataset.active = 'false';
  shadow.appendChild(shield);

  // ---- Theme -------------------------------------------------------------

  let theme: OverlayTheme | null = null;

  /**
   * Reads the page's palette and pushes it into the shadow tree as custom
   * properties. The host has to be in the document first: `getComputedStyle` on a
   * detached probe returns nothing to parse.
   */
  function applyTheme(): OverlayTheme | null {
    if (!host.isConnected) return theme;

    try {
      theme = deriveOverlayTheme(probe);
    } catch {
      // Reading a hostile page's computed styles is best-effort. The stylesheet's
      // own fallback accent is already in place, so losing this is cosmetic.
      return theme;
    }

    host.style.setProperty('--accent', theme.accent);
    host.style.setProperty('--accent-soft', theme.accentSoft);
    host.style.setProperty('--on-accent', theme.onAccent);
    host.style.setProperty('--halo', theme.halo);

    // Prefer the wider-gamut notation, but only where the browser understands it:
    // an unsupported value would silently drop the property back to the fallback.
    if (window.CSS?.supports?.('color', theme.accentOklch)) {
      host.style.setProperty('--accent', theme.accentOklch);
    }

    return theme;
  }

  // ---- Rect tracking -----------------------------------------------------

  /** Height of the dimension badge plus its gap below the frame. */
  const BADGE_CLEARANCE = 26;

  function syncRect(): void {
    if (!player || !player.target.isConnected) return;
    const rect = player.target.getBoundingClientRect();
    frame.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;

    // Figma hangs the size tag below the selection; near the bottom of the
    // viewport that would put it off screen, so it moves inside instead.
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    frame.dataset.badge =
      rect.bottom + BADGE_CLEARANCE > viewportHeight && rect.height > 48 ? 'inside' : 'below';
  }

  function tick(): void {
    rafId = null;
    syncRect();
    if (visible || drag) startLoop();
  }

  function startLoop(): void {
    if (rafId === null && !destroyed) rafId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---- Visibility --------------------------------------------------------

  function show(): void {
    if (!player || destroyed) return;
    if (document.fullscreenElement) return;
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (visible) return;
    visible = true;
    syncRect();
    frame.dataset.visible = 'true';
    startLoop();
  }

  function hideSoon(): void {
    if (drag) return;
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideNow, HIDE_DELAY_MS);
  }

  function hideNow(): void {
    hideTimer = null;
    if (drag) return;
    if (shadow.activeElement) return; // a handle still has keyboard focus
    visible = false;
    frame.dataset.visible = 'false';
    stopLoop();
  }

  /** Is this event target the player, our overlay, or inside either? */
  function isOverPlayer(node: EventTarget | null): boolean {
    if (!player || !(node instanceof Node)) return false;
    if (node === host || host.contains(node)) return true;
    if (node === player.target || node === player.core) return true;
    if (player.target.contains(node)) return true;
    return false;
  }

  function pointInFrame(x: number, y: number, pad = 14): boolean {
    if (!player || !player.target.isConnected) return false;
    const r = player.target.getBoundingClientRect();
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function onPointerOver(e: PointerEvent): void {
    if (!player) return;
    if (isOverPlayer(e.target)) show();
  }

  function onPointerOut(e: PointerEvent): void {
    if (!player) return;
    if (!isOverPlayer(e.relatedTarget)) hideSoon();
  }

  function onPointerMove(e: PointerEvent): void {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (!player || drag || hoverRafPending) return;
    hoverRafPending = true;
    const { clientX, clientY } = e;
    requestAnimationFrame(() => {
      hoverRafPending = false;
      if (pointInFrame(clientX, clientY)) show();
      else hideSoon();
    });
  }

  function onFullscreenChange(): void {
    if (document.fullscreenElement) {
      if (drag) endDrag(false);
      hideNow();
    }
  }

  // ---- Sizing ------------------------------------------------------------

  function maxWidth(): number {
    const natural = player?.naturalWidth ?? 0;
    return Math.max(window.innerWidth * 3, natural * 4, 3840);
  }

  function maxHeight(): number {
    const natural = player?.naturalHeight ?? 0;
    return Math.max(window.innerHeight * 3, natural * 4, 2160);
  }

  function clampSize(width: number, height: number, ratio: number, lock: boolean) {
    let w = Math.min(Math.max(width, MIN_WIDTH), maxWidth());
    let h = Math.min(Math.max(height, MIN_HEIGHT), maxHeight());

    if (lock && ratio > 0) {
      // Re-derive the free axis after clamping so the ratio survives the clamp.
      if (w !== width) h = Math.min(Math.max(w / ratio, MIN_HEIGHT), maxHeight());
      if (h !== height) w = Math.min(Math.max(h * ratio, MIN_WIDTH), maxWidth());
    }

    return { width: Math.round(w), height: Math.round(h) };
  }

  function setSize(width: number, height: number): void {
    if (!player || !sizing) return;
    const next = clampSize(width, height, player.aspectRatio, false);
    sizing.apply(next.width, next.height);
    size = next;
    updateReadout();
    syncRect();
  }

  function resetSize(): void {
    if (!player || !sizing) return;
    sizing.restore();
    size = { width: player.naturalWidth, height: player.naturalHeight };
    updateReadout();
    syncRect();
    flashReadout();
    callbacks.onReset?.();
  }

  function updateReadout(): void {
    if (!player) return;
    const rect = player.target.getBoundingClientRect();
    const w = Math.round(size?.width ?? rect.width);
    const h = Math.round(size?.height ?? rect.height);
    readoutW.textContent = String(w);
    readoutH.textContent = String(h);

    const pct = player.naturalWidth > 0 ? Math.round((w / player.naturalWidth) * 100) : 100;
    readoutScale.textContent = `${pct}%`;
  }

  function flashReadout(): void {
    frame.dataset.readout = 'true';
    if (readoutTimer !== null) clearTimeout(readoutTimer);
    readoutTimer = setTimeout(() => {
      readoutTimer = null;
      if (!drag) frame.dataset.readout = 'false';
    }, READOUT_LINGER_MS);
  }

  // ---- Drag --------------------------------------------------------------

  function lockSelection(): void {
    const root = document.documentElement;
    savedUserSelect = {
      value: root.style.getPropertyValue('user-select'),
      priority: root.style.getPropertyPriority('user-select'),
    };
    root.style.setProperty('user-select', 'none', 'important');
  }

  function unlockSelection(): void {
    const root = document.documentElement;
    root.style.removeProperty('user-select');
    if (savedUserSelect?.value) {
      root.style.setProperty('user-select', savedUserSelect.value, savedUserSelect.priority);
    }
    savedUserSelect = null;
  }

  /** A drag that ends over the video would otherwise pause it on mouseup. */
  function suppressNextClick(): void {
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 320);
  }

  function onHandlePointerDown(e: PointerEvent, pos: HandlePosition, el: HTMLElement): void {
    if (!player || !sizing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = player.target.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      handle: pos,
      handleEl: el,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      ratio: player.aspectRatio > 0 ? player.aspectRatio : rect.width / rect.height,
    };

    el.dataset.grabbed = 'true';
    frame.dataset.dragging = 'true';
    frame.dataset.readout = 'true';
    shield.dataset.active = 'true';
    shield.style.cursor = RESIZE_CURSORS[pos];

    lockSelection();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is a nicety; the shield keeps the drag alive without it.
    }
    show();
    startLoop();
  }

  function onWindowPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    lastPointer = { x: e.clientX, y: e.clientY };
    pendingPointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey };
    if (dragRaf === null) dragRaf = requestAnimationFrame(applyDragFrame);
  }

  function applyDragFrame(): void {
    dragRaf = null;
    if (!drag || !pendingPointer || !player || !sizing) return;

    const { x, y, shift, alt } = pendingPointer;
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    // Shift inverts whatever the aspect-lock setting is, so both "usually locked"
    // and "usually free" users get the other behaviour without opening the popup.
    const lock = settings.lockAspectRatio !== shift;
    const next = computeDragSize(
      drag.handle,
      dx,
      dy,
      drag.startWidth,
      drag.startHeight,
      drag.ratio,
      lock,
    );

    const snapped = alt ? next : snapSize(next, drag.ratio, lock);
    const final = clampSize(snapped.width, snapped.height, drag.ratio, lock);

    sizing.apply(final.width, final.height);
    size = final;
    updateReadout();
    callbacks.onLive?.(final.width, final.height);
  }

  function snapSize(
    candidate: { width: number; height: number },
    ratio: number,
    lock: boolean,
  ): { width: number; height: number } {
    if (!player) return candidate;

    const targets = [
      player.naturalWidth * 0.5,
      player.naturalWidth * 0.75,
      player.naturalWidth,
      player.naturalWidth * 1.25,
      player.naturalWidth * 1.5,
      player.naturalWidth * 2,
      window.innerWidth,
      window.innerWidth - 32,
    ];

    for (const t of targets) {
      if (t > 0 && Math.abs(candidate.width - t) <= SNAP_THRESHOLD) {
        const width = Math.round(t);
        return {
          width,
          height: lock && ratio > 0 ? Math.round(width / ratio) : candidate.height,
        };
      }
    }
    return candidate;
  }

  function onWindowPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(true);
  }

  function onWindowKeyDown(e: KeyboardEvent): void {
    if (drag && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const { startWidth, startHeight } = drag;
      endDrag(false);
      setSize(startWidth, startHeight);
      callbacks.onCommit(Math.round(startWidth), Math.round(startHeight));
    }
  }

  function endDrag(commit: boolean): void {
    if (!drag) return;
    const { handleEl, pointerId } = drag;

    if (dragRaf !== null) {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    pendingPointer = null;

    try {
      if (handleEl.hasPointerCapture(pointerId)) handleEl.releasePointerCapture(pointerId);
    } catch {
      // Already released.
    }

    handleEl.dataset.grabbed = 'false';
    frame.dataset.dragging = 'false';
    shield.dataset.active = 'false';
    shield.style.cursor = '';
    unlockSelection();
    suppressNextClick();

    drag = null;
    flashReadout();

    if (commit && size) callbacks.onCommit(size.width, size.height);
    if (!lastPointer || !pointInFrame(lastPointer.x, lastPointer.y)) hideSoon();
  }

  // ---- Keyboard ----------------------------------------------------------

  /**
   * Arrow keys always mean "grow toward the arrow", whichever handle has focus.
   * Mapping each handle's own axis signs onto the keys would be more literal and
   * far harder to predict.
   */
  function onHandleKeyDown(e: KeyboardEvent): void {
    if (!player || !sizing) return;

    const step = e.shiftKey ? KEY_STEP_FINE : KEY_STEP;
    let dw = 0;
    let dh = 0;

    switch (e.key) {
      case 'ArrowLeft': dw = -step; break;
      case 'ArrowRight': dw = step; break;
      case 'ArrowUp': dh = -step; break;
      case 'ArrowDown': dh = step; break;
      case 'Escape':
        (e.currentTarget as HTMLElement).blur();
        hideSoon();
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    const rect = player.target.getBoundingClientRect();
    const lock = settings.lockAspectRatio;
    const ratio = player.aspectRatio;

    let width = rect.width + dw;
    let height = rect.height + dh;
    if (lock && ratio > 0) {
      if (dw !== 0) height = width / ratio;
      else width = height * ratio;
    }

    const final = clampSize(width, height, ratio, lock);
    sizing.apply(final.width, final.height);
    size = final;
    updateReadout();
    flashReadout();
    show();

    if (keyCommitTimer !== null) clearTimeout(keyCommitTimer);
    keyCommitTimer = setTimeout(() => {
      keyCommitTimer = null;
      if (size) callbacks.onCommit(size.width, size.height);
    }, KEY_COMMIT_DELAY_MS);
  }

  // ---- Lifecycle ---------------------------------------------------------

  function attach(next: DetectedPlayer): void {
    if (destroyed) return;
    if (drag) endDrag(false);

    // Drop players that a SPA navigation removed, so the maps don't grow forever.
    for (const core of sessions.keys()) {
      if (!core.isConnected) {
        sessions.delete(core);
        naturals.delete(core);
      }
    }

    let natural = naturals.get(next.core);
    if (!natural) {
      natural = { width: next.naturalWidth, height: next.naturalHeight };
      naturals.set(next.core, natural);
    }

    let session = sessions.get(next.core);
    if (!session) {
      session = createSizingSession(
        { target: next.target, descendants: next.descendants },
        { allowOverflow: settings.allowOverflow },
      );
      sessions.set(next.core, session);
    }

    player = { ...next, naturalWidth: natural.width, naturalHeight: natural.height };
    sizing = session;

    const rect = player.target.getBoundingClientRect();
    size = session.isApplied
      ? { width: Math.round(rect.width), height: Math.round(rect.height) }
      : { ...natural };

    // Mirror the player's own corner rounding so the frame sits on the pixels the
    // user actually sees, not on an invisible square box.
    const radius = getComputedStyle(player.target).borderRadius;
    frame.style.borderRadius = radius && radius !== '0px' ? radius : '2px';

    if (!host.isConnected) {
      document.documentElement.appendChild(host);
      applyTheme();
    }

    updateReadout();
    syncRect();
  }

  function detach(): void {
    if (drag) endDrag(false);
    sizing = null;
    player = null;
    size = null;
    visible = false;
    frame.dataset.visible = 'false';
    frame.dataset.readout = 'false';
    stopLoop();
    if (host.isConnected) host.remove();
  }

  function restoreAll(): void {
    for (const session of sessions.values()) session.restore();
    sessions.clear();
    naturals.clear();
    if (player) size = { width: player.naturalWidth, height: player.naturalHeight };
    updateReadout();
    syncRect();
  }

  function destroy(): void {
    restoreAll();
    detach();
    destroyed = true;
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerUp, true);
    window.removeEventListener('keydown', onWindowKeyDown, true);
    window.removeEventListener('scroll', syncRect, true);
    window.removeEventListener('resize', syncRect);
    if (hideTimer !== null) clearTimeout(hideTimer);
    if (readoutTimer !== null) clearTimeout(readoutTimer);
    if (keyCommitTimer !== null) clearTimeout(keyCommitTimer);
  }

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerup', onWindowPointerUp, true);
  window.addEventListener('pointercancel', onWindowPointerUp, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  window.addEventListener('scroll', syncRect, { capture: true, passive: true });
  window.addEventListener('resize', syncRect);

  return {
    attach,
    detach,
    restoreAll,
    destroy,
    updateSettings(next: OverlaySettings) {
      settings = { ...next };
    },
    setSize,
    resetSize,
    getSize: () => (size ? { ...size } : null),
    getPlayer: () => player,
    isResized: () => sizing?.isApplied ?? false,
    refreshTheme: applyTheme,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested directly)
// ---------------------------------------------------------------------------

export function getHandleAnchor(pos: HandlePosition): { top: string; left: string } {
  const axes = HANDLE_AXES[pos];
  const toPercent = (v: -1 | 0 | 1) => (v === -1 ? '0%' : v === 1 ? '100%' : '50%');
  return { top: toPercent(axes.y), left: toPercent(axes.x) };
}

/**
 * Resolve a drag delta into a new box.
 *
 * Only width and height change -- we never translate the element. Dragging the
 * left edge outward therefore widens the player leftward *in flow terms*, which
 * for a centred player looks symmetric and for a left-aligned one grows to the
 * right. That is the same contract as the native CSS `resize` property.
 */
export function computeDragSize(
  handle: HandlePosition,
  dx: number,
  dy: number,
  startWidth: number,
  startHeight: number,
  ratio: number,
  lockAspectRatio: boolean,
): { width: number; height: number } {
  const axes = HANDLE_AXES[handle];
  let width = axes.x === 0 ? startWidth : startWidth + dx * axes.x;
  let height = axes.y === 0 ? startHeight : startHeight + dy * axes.y;

  if (lockAspectRatio && ratio > 0) {
    if (axes.x !== 0 && axes.y === 0) {
      height = width / ratio;
    } else if (axes.y !== 0 && axes.x === 0) {
      width = height * ratio;
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }

  return { width: Math.round(width), height: Math.round(height) };
}
