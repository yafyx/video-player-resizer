import { HANDLE_POSITIONS, HANDLE_SIZE, RESIZE_CURSORS, MIN_WIDTH, MIN_HEIGHT } from './constants';
import type { HandlePosition } from './constants';
import type { ExtensionSettings as Settings } from './storage';

interface DragState {
  handle: HandlePosition;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  aspectRatio: number;
  lockRatio: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Create and mount resize handles around a video player element using a ShadowRoot.
 *
 * @returns An object with `remove()` and `update(settings)` methods.
 */
export function createResizeHandles(
  ctx: { onInvalidated?: (cb: () => void) => void },
  target: HTMLElement,
  naturalWidth: number,
  naturalHeight: number,
  settings: Settings,
  onDimensionsChanged: (w: number, h: number) => void,
): { remove: () => void; update: (s: Settings) => void } {
  let activeDrag: DragState | null = null;
  let currentTarget: HTMLElement | null = null;

  const originalPosition = target.style.position;
  const needsPosition = originalPosition === '' || originalPosition === 'static';
  if (needsPosition) {
    target.style.position = 'relative';
  }

  currentTarget = target;
  let currentSettings = { ...settings };

  // ---- Create shadow host inside the target ----
  const host = document.createElement('div');
  host.id = 'vrh-host';
  Object.assign(host.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });

  // Attach shadow root
  const shadow = host.attachShadow({ mode: 'open' });

  // Style element for shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    #overlay {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 2147483647;
      box-sizing: border-box;
    }
    .handle {
      position: absolute;
      box-sizing: border-box;
      pointer-events: auto;
      z-index: 2147483647;
    }
  `;
  shadow.appendChild(style);

  // Overlay div that holds the handles
  const overlay = document.createElement('div');
  overlay.id = 'overlay';

  for (const pos of HANDLE_POSITIONS) {
    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.dataset.handle = pos;
    handle.style.width = `${HANDLE_SIZE}px`;
    handle.style.height = `${HANDLE_SIZE}px`;
    handle.style.backgroundColor = '#4a9eff';
    handle.style.border = '2px solid #ffffff';
    handle.style.borderRadius = '2px';
    handle.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';
    handle.style.cursor = RESIZE_CURSORS[pos];
    handle.style.transform = 'translate(-50%, -50%)';

    const { top, left } = getHandleAnchor(pos);
    handle.style.top = top;
    handle.style.left = left;

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = target.getBoundingClientRect();
      activeDrag = {
        handle: pos,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        aspectRatio: naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : rect.width / rect.height,
        lockRatio: currentSettings.lockAspectRatio,
        naturalWidth,
        naturalHeight,
      };
    });

    overlay.appendChild(handle);
  }

  shadow.appendChild(overlay);

  // Make sure the host covers the target by wrapping it around the target's content
  // We insert the host as the first child of the target so it overlays properly
  target.insertBefore(host, target.firstChild);

  // ---- Drag event handlers (attached to document) ----
  function onMouseMove(e: MouseEvent): void {
    if (!activeDrag || !currentTarget) return;
    e.preventDefault();

    const { handle, startX, startY, startWidth, startHeight, lockRatio, aspectRatio: ar } = activeDrag;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newWidth = startWidth;
    let newHeight = startHeight;
    let translateX = 0;
    let translateY = 0;

    switch (handle) {
      case 'r':  newWidth = startWidth + dx; break;
      case 'l':  newWidth = startWidth - dx; translateX = -dx; break;
      case 'b':  newHeight = startHeight + dy; break;
      case 't':  newHeight = startHeight - dy; translateY = -dy; break;
      case 'br': newWidth = startWidth + dx; newHeight = startHeight + dy; break;
      case 'bl': newWidth = startWidth - dx; newHeight = startHeight + dy; translateX = -dx; break;
      case 'tr': newWidth = startWidth + dx; newHeight = startHeight - dy; translateY = -dy; break;
      case 'tl': newWidth = startWidth - dx; newHeight = startHeight - dy; translateX = -dx; translateY = -dy; break;
    }

    // Aspect ratio lock
    if (lockRatio && ar > 0) {
      if (handle === 'r' || handle === 'l') {
        newHeight = newWidth / ar;
        if (handle === 'l') translateY = startHeight - newHeight;
      } else if (handle === 't' || handle === 'b') {
        newWidth = newHeight * ar;
        if (handle === 't') translateX = startWidth - newWidth;
      } else {
        // Corner: use dominant axis
        if (Math.abs(dx) >= Math.abs(dy)) {
          newHeight = newWidth / ar;
        } else {
          newWidth = newHeight * ar;
        }
        // Recalculate translations for corner with ratio lock
        if (handle === 'tl' || handle === 'tr') {
          translateY = startHeight - newHeight;
        } else {
          translateY = 0;
        }
        if (handle === 'tl' || handle === 'bl') {
          translateX = startWidth - newWidth;
        } else {
          translateX = 0;
        }
      }
    }

    newWidth = Math.max(MIN_WIDTH, Math.round(newWidth));
    newHeight = Math.max(MIN_HEIGHT, Math.round(newHeight));

    currentTarget.style.width = `${newWidth}px`;
    currentTarget.style.height = `${newHeight}px`;

    if (translateX !== 0 || translateY !== 0) {
      currentTarget.style.transform = `translate(${translateX}px, ${translateY}px)`;
    } else {
      currentTarget.style.transform = '';
    }
  }

  function onMouseUp(_e: MouseEvent): void {
    if (!activeDrag || !currentTarget) return;

    const rect = currentTarget.getBoundingClientRect();
    onDimensionsChanged(Math.round(rect.width), Math.round(rect.height));

    if (['r', 'b', 'br'].includes(activeDrag.handle)) {
      currentTarget.style.transform = '';
    }

    activeDrag = null;
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // ---- Cleanup ----
  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    activeDrag = null;

    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }

    if (needsPosition) {
      target.style.position = originalPosition;
    }

    currentTarget = null;
  }

  // Register cleanup on context invalidate
  if (ctx.onInvalidated) {
    ctx.onInvalidated(cleanup);
  }

  return {
    remove: cleanup,
    update: (s: Settings) => {
      currentSettings = { ...s };
    },
  };
}

// ---- Helpers ----

export function getHandleAnchor(pos: HandlePosition): { top: string; left: string } {
  const center = '50%';
  const zero = '0';

  switch (pos) {
    case 'tl': return { top: zero, left: zero };
    case 't':  return { top: zero, left: center };
    case 'tr': return { top: zero, left: '100%' };
    case 'r':  return { top: center, left: '100%' };
    case 'br': return { top: '100%', left: '100%' };
    case 'b':  return { top: '100%', left: center };
    case 'bl': return { top: '100%', left: zero };
    case 'l':  return { top: center, left: zero };
  }
}

export function applyDimensions(el: HTMLElement, width: number, height: number): void {
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.transform = '';
}

export function resetDimensions(el: HTMLElement): void {
  el.style.width = '';
  el.style.height = '';
  el.style.transform = '';
  el.style.position = '';
}