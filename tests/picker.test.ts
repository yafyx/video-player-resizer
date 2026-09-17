import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { startElementPicker } from '../utils/picker';
import type { PickerSession } from '../utils/picker';
import { PICKER_HOST_ID } from '../utils/constants';

/**
 * jsdom implements no hit testing, so `elementsFromPoint` is stubbed with the
 * stack a real engine would return: topmost first.
 */
function stubStack(elements: Element[]): void {
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () =>
    elements;
}

function movePointer(): void {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
}

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

function click(): void {
  window.dispatchEvent(new MouseEvent('click', { cancelable: true }));
}

describe('startElementPicker', () => {
  let session: PickerSession | null = null;
  let onPick: Mock<(el: HTMLElement) => void>;
  let onCancel: Mock<() => void>;

  beforeEach(() => {
    document.body.innerHTML = '';
    onPick = vi.fn<(el: HTMLElement) => void>();
    onCancel = vi.fn<() => void>();
  });

  afterEach(() => {
    session?.stop();
    session = null;
  });

  function start(): PickerSession {
    session = startElementPicker({ onPick, onCancel });
    return session;
  }

  it('hands back the element under the cursor', () => {
    document.body.innerHTML = '<div><video></video></div>';
    const video = document.querySelector('video')!;
    stubStack([video]);

    start();
    movePointer();
    click();

    expect(onPick).toHaveBeenCalledWith(video);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ignores its own host, which sits on top of every point', () => {
    document.body.innerHTML = '<div><video></video></div>';
    const video = document.querySelector('video')!;

    start();
    stubStack([document.getElementById(PICKER_HOST_ID)!, video]);
    movePointer();
    click();

    expect(onPick).toHaveBeenCalledWith(video);
  });

  it('climbs to the wrapper on [', () => {
    document.body.innerHTML = '<div class="wrap"><video></video></div>';
    const video = document.querySelector('video')!;
    const wrap = document.querySelector('.wrap')!;
    stubStack([video]);

    start();
    movePointer();
    press('[');
    click();

    expect(onPick).toHaveBeenCalledWith(wrap);
  });

  it('comes back down on ]', () => {
    document.body.innerHTML = '<div class="wrap"><video></video></div>';
    const video = document.querySelector('video')!;
    stubStack([video]);

    start();
    movePointer();
    press('[');
    press(']');
    click();

    expect(onPick).toHaveBeenCalledWith(video);
  });

  it('refuses to climb past the page itself', () => {
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video')!;
    stubStack([video]);

    start();
    movePointer();
    for (let i = 0; i < 8; i++) press('[');
    click();

    // <body> is the only step up, and it is never a target.
    expect(onPick).toHaveBeenCalledWith(video);
  });

  it('offers nothing when the cursor is over the page background', () => {
    stubStack([document.body]);

    start();
    movePointer();
    click();

    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('resets the depth when the cursor moves to a different element', () => {
    document.body.innerHTML = '<div class="a"><video id="one"></video></div><div class="b"><video id="two"></video></div>';
    const [one, two] = Array.from(document.querySelectorAll('video'));

    stubStack([one]);
    start();
    movePointer();
    press('['); // now on div.a

    stubStack([two]);
    movePointer();
    click();

    expect(onPick).toHaveBeenCalledWith(two);
  });

  it('cancels on Escape without picking anything', () => {
    document.body.innerHTML = '<video></video>';
    stubStack([document.querySelector('video')!]);

    start();
    movePointer();
    press('Escape');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('cancels on a right-click', () => {
    document.body.innerHTML = '<video></video>';
    stubStack([document.querySelector('video')!]);

    start();
    movePointer();
    window.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('confirms on Enter, for a keyboard-only run', () => {
    document.body.innerHTML = '<div><video></video></div>';
    const video = document.querySelector('video')!;
    stubStack([video]);

    start();
    const host = document.getElementById(PICKER_HOST_ID)!;
    expect(host.getAttribute('role')).toBe('dialog');
    expect(host.getAttribute('aria-modal')).toBe('true');
    expect(host.getAttribute('aria-label')).toContain('Enter to choose');
    expect(document.activeElement).toBe(host);
    press('Enter');

    expect(onPick).toHaveBeenCalledWith(video);
  });

  it('keeps Tab focus inside its one-target modal', () => {
    document.body.innerHTML = '<button>Page action</button><video></video>';
    stubStack([document.querySelector('video')!]);
    start();
    const host = document.getElementById(PICKER_HOST_ID)!;

    press('Tab');

    expect(document.activeElement).toBe(host);
  });

  it('swallows the click so the page never sees it', () => {
    document.body.innerHTML = '<video></video>';
    stubStack([document.querySelector('video')!]);

    start();
    movePointer();

    const event = new MouseEvent('click', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves no host or listener behind after stop()', () => {
    document.body.innerHTML = '<video></video>';
    stubStack([document.querySelector('video')!]);

    const picker = start();
    expect(document.getElementById(PICKER_HOST_ID)).not.toBeNull();

    picker.stop();

    expect(document.getElementById(PICKER_HOST_ID)).toBeNull();
    // Neither handler fires: `stop()` is teardown, not a decision by the user.
    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    // Events after teardown reach nothing.
    movePointer();
    click();
    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('survives being stopped twice', () => {
    stubStack([]);
    const picker = start();

    picker.stop();
    expect(() => picker.stop()).not.toThrow();
  });

  it('drops a candidate that leaves the DOM before the click', () => {
    document.body.innerHTML = '<div><video></video></div>';
    const video = document.querySelector('video')!;
    stubStack([video]);

    start();
    movePointer();
    video.remove();
    click();

    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
