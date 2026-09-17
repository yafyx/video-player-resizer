import { MAX_PICK_CLIMB, PICKER_HOST_ID } from './constants';
import { PICKER_CSS } from './pickerStyles';
import { elementLabel } from './elementPath';
import { deriveOverlayTheme } from './theme';
import { ancestorPath, isOwnHost } from './videoDetector';

/**
 * The element picker: a modal hover-and-click mode for choosing the resize
 * target by hand.
 *
 * Detection is a heuristic, and on a page it reads wrongly there is no argument
 * to be had with it -- the user can see the box they want. This lets them say so
 * directly, including for wrappers `resolveChain` would never climb to and for
 * players scoring too low to be detected at all.
 */

export interface PickerHandlers {
  /** The user committed to an element. */
  onPick: (el: HTMLElement) => void;
  /** The user backed out with Escape, a right-click, or a click on nothing. */
  onCancel: () => void;
}

export interface PickerSession {
  /** Tear down without firing either handler. Safe to call more than once. */
  stop: () => void;
}

/** Boxes that are the page rather than something in it. */
const NEVER_PICK = new Set(['HTML', 'BODY']);

/** Below this the tag would hang off the top of the viewport, so it moves inside. */
const TAG_CLEARANCE = 27;

export function startElementPicker(handlers: PickerHandlers): PickerSession {
  // ---- Shadow tree -------------------------------------------------------

  const host = document.createElement('div');
  host.id = PICKER_HOST_ID;
  // Same belt and braces as the resize overlay: a blanket page rule must not be
  // able to take our host out before the shadow styles ever apply.
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('pointer-events', 'auto', 'important');
  host.style.setProperty('cursor', 'crosshair', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.tabIndex = -1;
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute(
    'aria-label',
    'Choose an element to resize. Move the pointer to highlight an element. Press left bracket to widen, right bracket to narrow, Enter to choose, or Escape to cancel.',
  );

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PICKER_CSS;
  shadow.appendChild(style);

  const probe = document.createElement('div');
  probe.className = 'probe';
  shadow.appendChild(probe);

  const box = document.createElement('div');
  box.className = 'box';
  box.dataset.live = 'false';
  box.dataset.tag = 'above';

  const tag = document.createElement('div');
  tag.className = 'tag';
  const tagName = document.createElement('span');
  const tagSize = document.createElement('span');
  tagSize.className = 'size';
  const tagDepth = document.createElement('span');
  tagDepth.className = 'depth';
  tag.append(tagName, tagSize, tagDepth);
  box.appendChild(tag);
  shadow.appendChild(box);

  shadow.appendChild(buildHint());

  // ---- State -------------------------------------------------------------

  /** Element under the cursor. `candidate` is this plus `climb` steps upward. */
  let base: HTMLElement | null = null;
  let climb = 0;
  let candidate: HTMLElement | null = null;
  let pointer: { x: number; y: number } | null = null;
  let rafId: number | null = null;
  let done = false;

  // ---- Candidate resolution ----------------------------------------------

  /** Everything from the hovered element up to, but never including, the page. */
  function pickPath(from: HTMLElement | null): HTMLElement[] {
    if (!from || NEVER_PICK.has(from.tagName)) return [];
    const path = ancestorPath(from).slice(0, MAX_PICK_CLIMB);
    const stop = path.findIndex((node) => NEVER_PICK.has(node.tagName));
    return stop === -1 ? path : path.slice(0, stop);
  }

  function deepElementFromPoint(x: number, y: number): HTMLElement | null {
    const stack =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : ([document.elementFromPoint(x, y)].filter(Boolean) as Element[]);

    // Our own host is the topmost hit at every point -- that is what swallows the
    // click. The element the user means is the next one down.
    const hit = stack.find((node) => !isOwnHost(node));
    if (!(hit instanceof HTMLElement)) return null;
    let el: HTMLElement = hit;

    // Hit testing stops at a shadow host, so descend the rest of the way by hand.
    for (let i = 0; el.shadowRoot && i < 20; i++) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!(inner instanceof HTMLElement) || inner === el) break;
      el = inner;
    }

    return el;
  }

  function retarget(x: number, y: number): void {
    const next = deepElementFromPoint(x, y);
    // Staying on the same element keeps whatever depth the user dialled in;
    // resetting on every jitter would make `[` unusable.
    if (next === base) return;

    base = next;
    climb = 0;
    const path = pickPath(base);
    candidate = path[0] ?? null;
    paint();
  }

  function step(delta: number): void {
    const path = pickPath(base);
    if (path.length === 0) return;
    climb = Math.max(0, Math.min(climb + delta, path.length - 1));
    candidate = path[climb];
    paint();
  }

  // ---- Painting ----------------------------------------------------------

  /** Geometry only. Runs every frame, so it never touches text. */
  function track(): void {
    if (!candidate || !candidate.isConnected) {
      box.dataset.live = 'false';
      return;
    }

    const rect = candidate.getBoundingClientRect();
    box.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.dataset.live = 'true';
    box.dataset.tag = rect.top < TAG_CLEARANCE ? 'inside' : 'above';
  }

  function tick(): void {
    rafId = null;
    track();
    startLoop();
  }

  /** Guarded, so a `paint()` mid-frame cannot start a second chain. */
  function startLoop(): void {
    if (rafId === null && !done) rafId = requestAnimationFrame(tick);
  }

  function paint(): void {
    if (candidate) {
      const rect = candidate.getBoundingClientRect();
      tagName.textContent = elementLabel(candidate);
      tagSize.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
      tagDepth.textContent = climb > 0 ? `↑${climb}` : '';
    }
    track();
  }

  function applyTheme(): void {
    if (!host.isConnected) return;
    try {
      const theme = deriveOverlayTheme(probe);
      host.style.setProperty('--accent', theme.accent);
      host.style.setProperty('--accent-soft', theme.accentSoft);
      host.style.setProperty('--on-accent', theme.onAccent);
      host.style.setProperty('--halo', theme.halo);
      if (window.CSS?.supports?.('color', theme.accentOklch)) {
        host.style.setProperty('--accent', theme.accentOklch);
      }
    } catch {
      // Cosmetic: the stylesheet's own fallback accent is already in place.
    }
  }

  // ---- Exit --------------------------------------------------------------

  function teardown(): void {
    if (done) return;
    done = true;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    host.remove();
  }

  /** Always tears the picker down first: the handler will want the page back. */
  function confirm(): void {
    const chosen = candidate;
    teardown();
    if (chosen?.isConnected) handlers.onPick(chosen);
    else handlers.onCancel();
  }

  function cancel(): void {
    teardown();
    handlers.onCancel();
  }

  // ---- Input -------------------------------------------------------------

  function onPointerMove(e: PointerEvent): void {
    pointer = { x: e.clientX, y: e.clientY };
    retarget(e.clientX, e.clientY);
  }

  /** Swallow the press itself so the page gains no focus and selects no text. */
  function onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    confirm();
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    cancel();
  }

  function onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Tab':
        // The picker is a one-focus-target modal. Keep Tab inside it rather than
        // letting focus disappear into the page underneath the pointer shield.
        host.focus({ preventScroll: true });
        break;
      case 'Escape':
        cancel();
        break;
      case '[':
      case 'ArrowUp':
        step(1);
        break;
      case ']':
      case 'ArrowDown':
        step(-1);
        break;
      case 'Enter':
      case ' ':
        confirm();
        break;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();
  }

  /** Scrolling and resizing move the page under a stationary cursor. */
  function onScroll(): void {
    if (pointer) retarget(pointer.x, pointer.y);
  }

  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onScroll);

  document.documentElement.appendChild(host);
  applyTheme();
  // Start with a real candidate for keyboard users instead of requiring a
  // pointer movement before Enter and the depth controls can do anything.
  const center = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  pointer = center;
  retarget(center.x, center.y);
  host.focus({ preventScroll: true });
  startLoop();

  return { stop: teardown };
}

function buildHint(): HTMLElement {
  const hint = document.createElement('div');
  hint.className = 'hint';

  const title = document.createElement('strong');
  title.textContent = 'Pick the element to resize';
  hint.appendChild(title);

  const groups: [string[], string][] = [
    [['[', ']'], 'widen or narrow'],
    [['Enter'], 'choose'],
    [['Esc'], 'cancel'],
  ];

  for (const [keys, label] of groups) {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '·';
    hint.appendChild(sep);

    const group = document.createElement('span');
    for (const key of keys) {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      group.append(kbd, ' ');
    }
    group.append(label);
    hint.appendChild(group);
  }

  return hint;
}
