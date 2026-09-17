import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { TOOLBAR_HOST_ID } from '../utils/constants';
import type { ContentRequest, PlayerState } from '../utils/messages';
import { createControlToolbar } from '../utils/toolbar';
import type { ControlToolbar } from '../utils/toolbar';
import { isOwnHost } from '../utils/videoDetector';

function state(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    type: 'state',
    playerDetected: true,
    playerCount: 2,
    playerKind: 'video',
    isResized: true,
    currentWidth: 800,
    currentHeight: 450,
    naturalWidth: 640,
    naturalHeight: 360,
    settings: {
      enabled: true,
      lockAspectRatio: true,
      allowOverflow: true,
      rememberSize: true,
    },
    activeHere: true,
    hostname: 'example.com',
    players: [
      {
        id: 'one',
        label: 'video.main',
        kind: 'video',
        width: 640,
        height: 360,
        active: true,
      },
      {
        id: 'two',
        label: 'video.preview',
        kind: 'video',
        width: 480,
        height: 270,
        active: false,
      },
    ],
    picking: false,
    pickLabel: null,
    ...overrides,
  };
}

function button(root: ShadowRoot, text: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
  return match;
}

describe('createControlToolbar', () => {
  let toolbar: ControlToolbar | null = null;
  let dispatch: Mock<(message: ContentRequest) => Promise<PlayerState>>;

  beforeEach(() => {
    document.body.innerHTML = '<button id="page-control">Page control</button>';
    dispatch = vi.fn(async () => state());
    toolbar = createControlToolbar({ iconUrl: 'icon.png', dispatch });
  });

  afterEach(() => {
    toolbar?.destroy();
    toolbar = null;
  });

  function root(): ShadowRoot {
    const shadow = document.getElementById(TOOLBAR_HOST_ID)?.shadowRoot;
    if (!shadow) throw new Error('Toolbar is not mounted');
    return shadow;
  }

  it('toggles a top-level region without leaving the host interactive', () => {
    const host = document.getElementById(TOOLBAR_HOST_ID)!;
    const shell = root().querySelector('.shell') as HTMLElement;

    expect(host.style.pointerEvents).toBe('none');
    expect(isOwnHost(host)).toBe(true);
    expect(shell.hidden).toBe(true);

    toolbar?.toggle(state());
    expect(shell.hidden).toBe(false);
    expect(toolbar?.isOpen()).toBe(true);
    expect(root().activeElement).toBe(root().querySelector('.deck-cue'));

    toolbar?.toggle(state());
    expect(shell.hidden).toBe(true);
  });

  it('keeps the brand segment informational and non-interactive', () => {
    toolbar?.show(state());
    const brand = root().querySelector('.brand');
    const cue = root().querySelector('.deck-cue') as HTMLElement;
    const panel = root().querySelector('.panel') as HTMLElement;

    expect(brand?.tagName).toBe('DIV');
    expect(brand?.getAttribute('aria-expanded')).toBeNull();
    expect(brand?.getAttribute('tabindex')).toBeNull();
    expect(cue.tagName).toBe('BUTTON');
    expect(cue.getAttribute('type')).toBe('button');
    expect(cue.textContent).toContain('More below');
    expect(cue.getAttribute('aria-expanded')).toBe('false');
    expect(cue.querySelector('svg.deck-cue-icon path')?.getAttribute('stroke')).toBe('currentColor');
    expect(panel.hidden).toBe(true);
  });

  it('opens and closes the control deck from the More below cue', () => {
    toolbar?.show(state());
    const cue = root().querySelector('.deck-cue') as HTMLButtonElement;
    const panel = root().querySelector('.panel') as HTMLElement;

    cue.click();

    expect(cue.getAttribute('aria-expanded')).toBe('true');
    expect(cue.textContent).toContain('Hide controls');
    expect(panel.hidden).toBe(false);

    cue.click();

    expect(cue.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('returns focus to the disclosure control when Escape closes the deck', () => {
    toolbar?.show(state());
    const size = button(root(), '800 × 450');
    size.click();
    const setting = button(root(), 'Lock ratio');
    setting.focus();

    setting.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect((root().querySelector('.panel') as HTMLElement).hidden).toBe(true);
    expect(root().activeElement).toBe(size);
  });

  it('sends the existing site, preset, reset, and setting messages', async () => {
    toolbar?.show(state());
    (root().querySelector('.deck-cue') as HTMLButtonElement).click();

    button(root(), 'On this siteOn').click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'setEnabled', value: false }));

    (root().querySelector('[data-scale="1.5"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'applyPreset', scale: 1.5 }),
    );

    button(root(), 'Restore').click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'resetSize' }));

    button(root(), 'Lock ratio').click();
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: 'setSetting',
        key: 'lockAspectRatio',
        value: false,
      }),
    );
  });

  it('keeps manual and detected target controls reachable', async () => {
    toolbar?.show(state({ pickLabel: 'div.player-shell' }));
    (root().querySelector('.deck-cue') as HTMLButtonElement).click();

    button(root(), 'Use automatic').click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'clearPick' }));

    button(root(), 'video.preview').click();
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'selectPlayer', id: 'two' }),
    );
  });

  it('enables the site before starting the picker when controls are off', async () => {
    toolbar?.show(state({ activeHere: false }));

    button(root(), 'Select elementTarget').click();

    await vi.waitFor(() => {
      expect(dispatch.mock.calls.map(([message]) => message)).toEqual([
        { type: 'setEnabled', value: true },
        { type: 'startPicking' },
      ]);
    });
  });

  it('closes from a visible, named icon button and destroys cleanly', () => {
    toolbar?.show(state());
    const shell = root().querySelector('.shell') as HTMLElement;
    const close = root().querySelector('.close');

    expect(close).toBeInstanceOf(HTMLButtonElement);
    expect(close?.textContent).toBe('');
    expect(close?.getAttribute('aria-label')).toBe('Close Video Resizer controls');
    expect(close?.querySelector('svg.close-icon')).not.toBeNull();

    (close as HTMLButtonElement).click();
    expect(shell.hidden).toBe(true);

    toolbar?.destroy();
    expect(document.getElementById(TOOLBAR_HOST_ID)).toBeNull();
    toolbar = null;
  });

  it('preserves the original page focus across a temporary picker hide', () => {
    const pageControl = document.getElementById('page-control') as HTMLButtonElement;
    pageControl.focus();
    toolbar?.show(state());

    toolbar?.hide({ restoreFocus: false });
    toolbar?.show(state());
    toolbar?.hide();

    expect(document.activeElement).toBe(pageControl);
  });
});
