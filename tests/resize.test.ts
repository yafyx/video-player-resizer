import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getHandleAnchor, computeDragSize, createResizeOverlay } from '../utils/resize';
import type { ResizeOverlay } from '../utils/resize';
import { describePlayer } from '../utils/videoDetector';
import { OVERLAY_HOST_ID } from '../utils/constants';
import { stubLiveRect, stubRect } from './helpers';

describe('getHandleAnchor', () => {
  it.each([
    ['tl', { top: '0%', left: '0%' }],
    ['t', { top: '0%', left: '50%' }],
    ['tr', { top: '0%', left: '100%' }],
    ['r', { top: '50%', left: '100%' }],
    ['br', { top: '100%', left: '100%' }],
    ['b', { top: '100%', left: '50%' }],
    ['bl', { top: '100%', left: '0%' }],
    ['l', { top: '50%', left: '0%' }],
  ] as const)('anchors %s correctly', (pos, expected) => {
    expect(getHandleAnchor(pos)).toEqual(expected);
  });
});

describe('computeDragSize', () => {
  const start = { width: 640, height: 360 };
  const ratio = 16 / 9;

  it('grows to the right from the right handle', () => {
    expect(computeDragSize('r', 200, 0, start.width, start.height, ratio, false)).toEqual({
      width: 840,
      height: 360,
    });
  });

  it('grows from the left handle when dragged outward', () => {
    expect(computeDragSize('l', -200, 0, start.width, start.height, ratio, false)).toEqual({
      width: 840,
      height: 360,
    });
  });

  it('leaves the cross axis alone for an edge handle', () => {
    expect(computeDragSize('b', 0, 90, start.width, start.height, ratio, false)).toEqual({
      width: 640,
      height: 450,
    });
  });

  it('derives height from width when the ratio is locked', () => {
    expect(computeDragSize('r', 320, 0, start.width, start.height, ratio, true)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('derives width from height when a vertical edge drives a locked drag', () => {
    expect(computeDragSize('b', 0, 180, start.width, start.height, ratio, true)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('follows the dominant axis on a locked corner drag', () => {
    const horizontal = computeDragSize('br', 320, 10, start.width, start.height, ratio, true);
    expect(horizontal).toEqual({ width: 960, height: 540 });

    const vertical = computeDragSize('br', 10, 180, start.width, start.height, ratio, true);
    expect(vertical).toEqual({ width: 960, height: 540 });
  });
});

// ---------------------------------------------------------------------------

/** jsdom has no PointerEvent constructor, so a MouseEvent with pointer fields stands in. */
function pointerEvent(type: string, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

function handleFor(pos: string): HTMLElement {
  const host = document.getElementById(OVERLAY_HOST_ID);
  if (!host?.shadowRoot) throw new Error('overlay is not mounted');
  return host.shadowRoot.querySelector(`[data-handle="${pos}"]`) as HTMLElement;
}

describe('createResizeOverlay', () => {
  let overlay: ResizeOverlay | null = null;
  let frames: FrameRequestCallback[] = [];

  /**
   * The overlay batches drag writes into an animation frame and keeps a tracking
   * loop alive while visible. Driving frames by hand keeps the tests deterministic
   * and stops the self-rescheduling loop from spinning.
   */
  function flushFrame(): void {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
    vi.unstubAllGlobals();
  });

  it('mounts outside the player, so an iframe player still gets handles', () => {
    // An <iframe> can hold child nodes but never renders them. The previous
    // version injected the handle host *into* the target, which is why every
    // iframe-based player -- YouTube, Twitch, Vimeo embeds -- showed nothing.
    const frame = document.createElement('iframe');
    frame.setAttribute('src', 'https://www.youtube.com/embed/abc');
    stubRect(frame, { width: 640, height: 360 });
    document.body.appendChild(frame);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(frame));

    const host = document.getElementById(OVERLAY_HOST_ID);
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(document.documentElement);
    expect(host?.shadowRoot?.querySelectorAll('.handle')).toHaveLength(8);
    expect(frame.childElementCount).toBe(0);
  });

  it('resizes the media element itself when a handle is dragged', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    const onCommit = vi.fn();
    overlay = createResizeOverlay({ lockAspectRatio: false, allowOverflow: false }, { onCommit });
    overlay.attach(describePlayer(media));

    handleFor('r').dispatchEvent(pointerEvent('pointerdown', 640, 180));
    window.dispatchEvent(pointerEvent('pointermove', 840, 180));
    flushFrame();

    expect(media.style.getPropertyValue('width')).toBe('840px');
    expect(media.style.getPropertyPriority('width')).toBe('important');

    window.dispatchEvent(pointerEvent('pointerup', 840, 180));
    expect(onCommit).toHaveBeenCalledWith(840, 360);
  });

  it('keeps the ratio when the drag is locked', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    Object.defineProperty(media, 'videoWidth', { value: 1600 });
    Object.defineProperty(media, 'videoHeight', { value: 900 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: true, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    handleFor('r').dispatchEvent(pointerEvent('pointerdown', 640, 180));
    window.dispatchEvent(pointerEvent('pointermove', 960, 180));
    flushFrame();
    window.dispatchEvent(pointerEvent('pointerup', 960, 180));

    expect(overlay.getSize()).toEqual({ width: 960, height: 540 });
  });

  it('applies presets against the original size, not the current one', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    const player = describePlayer(media);
    overlay.attach(player);

    overlay.setSize(player.naturalWidth * 2, player.naturalHeight * 2);
    expect(overlay.getSize()).toEqual({ width: 1280, height: 720 });

    // Re-attaching must not treat the resized box as the new original.
    overlay.attach(describePlayer(media));
    expect(overlay.getPlayer()?.naturalWidth).toBe(640);
  });

  it('restores the page exactly, and reports when it has nothing to restore', () => {
    const media = document.createElement('video');
    media.style.width = '50%';
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    const onReset = vi.fn();
    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn(), onReset },
    );
    overlay.attach(describePlayer(media));

    expect(overlay.isResized()).toBe(false);

    overlay.setSize(1280, 720);
    expect(overlay.isResized()).toBe(true);

    overlay.resetSize();

    expect(overlay.isResized()).toBe(false);
    expect(media.style.getPropertyValue('width')).toBe('50%');
    expect(media.style.getPropertyPriority('width')).toBe('');
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('keeps a player sized after switching to another one on the page', () => {
    const first = document.createElement('video');
    const second = document.createElement('video');
    stubLiveRect(first, { width: 640, height: 360 });
    stubLiveRect(second, { width: 480, height: 270 });
    document.body.append(first, second);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );

    overlay.attach(describePlayer(first));
    overlay.setSize(1280, 720);

    overlay.attach(describePlayer(second));

    expect(first.style.getPropertyValue('width')).toBe('1280px');
    expect(overlay.getSize()).toEqual({ width: 480, height: 270 });

    overlay.restoreAll();
    expect(first.style.getPropertyValue('width')).toBe('');
  });

  it('removes the overlay from the page on detach', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull();

    overlay.detach();
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
  });
});
