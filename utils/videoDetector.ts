import { SITE_SELECTORS } from './constants';

export interface DetectedPlayer {
  /** The HTML element to resize (the player container) */
  element: HTMLElement;
  /** Original natural width (e.g. videoWidth for <video>, offsetWidth for containers) */
  naturalWidth: number;
  /** Original natural height */
  naturalHeight: number;
}

/**
 * Try to find a video player on the current page.
 * Returns null if nothing viable is detected.
 */
export function detectVideoPlayer(): DetectedPlayer | null {
  const hostname = window.location.hostname;

  // Strategy 1: Site-specific known selectors
  const siteEntry = Object.entries(SITE_SELECTORS).find(([host]) =>
    hostname.includes(host),
  );
  if (siteEntry) {
    const [, { selector }] = siteEntry;
    const el = document.querySelector<HTMLElement>(selector);
    if (el && isElementVisible(el)) {
      const { width, height } = getNaturalDimensions(el);
      if (width > 0 && height > 0) {
        return { element: el, naturalWidth: width, naturalHeight: height };
      }
    }
  }

  // Strategy 2: Direct <video> elements
  const videos = document.querySelectorAll<HTMLVideoElement>('video');
  if (videos.length > 0) {
    const candidates = Array.from(videos)
      .filter((v) => isElementVisible(v))
      .sort((a, b) => {
        const aArea = a.offsetWidth * a.offsetHeight;
        const bArea = b.offsetWidth * b.offsetHeight;
        return bArea - aArea;
      });

    const best = candidates[0];
    if (best) {
      // Prefer resizing a parent container rather than the <video> itself
      const parent = findBestContainer(best);
      const { width, height } = getNaturalDimensions(parent);
      if (width > 0 && height > 0) {
        return { element: parent, naturalWidth: width, naturalHeight: height };
      }
    }
  }

  // Strategy 3: Iframe-based players (Vimeo, YouTube embeds, etc.)
  const iframes = document.querySelectorAll<HTMLIFrameElement>(
    'iframe[src*="player.vimeo.com"], iframe[src*="youtube.com/embed"], iframe[src*="player.twitch.tv"]',
  );
  for (const iframe of iframes) {
    if (isElementVisible(iframe)) {
      return {
        element: iframe,
        naturalWidth: iframe.offsetWidth || 640,
        naturalHeight: iframe.offsetHeight || 360,
      };
    }
  }

  return null;
}

/**
 * Check if element is visible (has non-zero dimensions and is not hidden).
 */
export function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  return true;
}

/**
 * Get "natural" dimensions from an element.
 * For <video> elements, prefer videoWidth/videoHeight.
 * For containers, use the current computed or offset dimensions.
 */
function getNaturalDimensions(el: HTMLElement): { width: number; height: number } {
  if (el instanceof HTMLVideoElement) {
    const vw = el.videoWidth;
    const vh = el.videoHeight;
    if (vw > 0 && vh > 0) {
      return { width: vw, height: vh };
    }
  }
  return {
    width: el.offsetWidth,
    height: el.offsetHeight,
  };
}

/**
 * Find the best container to resize for a <video> element.
 * Walk up the parent chain until we find a reasonable block-level container.
 */
function findBestContainer(video: HTMLVideoElement): HTMLElement {
  let current: HTMLElement | null = video;
  // Walk up at most 5 levels to avoid resizing too broadly
  for (let i = 0; i < 5; i++) {
    const next = current.parentElement;
    if (!next) break;

    const style = window.getComputedStyle(next);
    const isBlockLike =
      style.display === 'block' ||
      style.display === 'flex' ||
      style.display === 'inline-flex' ||
      style.display === 'grid';

    const isContainer =
      next.tagName === 'DIV' ||
      next.tagName === 'SECTION' ||
      next.tagName === 'ARTICLE' ||
      next.tagName === 'FIGURE';

    if (isBlockLike && isContainer && next.offsetWidth >= video.offsetWidth * 0.8) {
      current = next;
    } else {
      break;
    }
  }
  return current ?? video;
}

/**
 * Observe the DOM for dynamically-added video players (SPAs).
 * Calls `onDetect` when a new player is found. Returns a disconnect function.
 */
export function observeVideoPlayers(
  onDetect: (player: DetectedPlayer) => void,
): () => void {
  let detectedIds = new Set<symbol>();

  const run = () => {
    const player = detectVideoPlayer();
    if (player) {
      const id = Symbol.for(`player-${player.element.tagName}-${player.element.offsetWidth}`);
      if (!detectedIds.has(id)) {
        detectedIds = new Set([id]);
        onDetect(player);
      }
    }
  };

  // Run immediately
  run();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      run();
    }, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => observer.disconnect();
}