import {
  EMBED_PATTERNS,
  SITE_SELECTORS,
  MIN_CANDIDATE_WIDTH,
  MIN_CANDIDATE_HEIGHT,
  GENERIC_EMBED_MIN_RATIO,
  GENERIC_EMBED_MAX_RATIO,
  GENERIC_EMBED_MIN_WIDTH,
  MAX_TARGET_CLIMB,
  DEEP_QUERY_NODE_BUDGET,
  OVERLAY_HOST_ID,
} from './constants';
import { measureBox } from './sizing';
import type { SizingChain } from './sizing';

export interface DetectedPlayer extends SizingChain {
  /** The element that actually renders the media: a `<video>` or a player `<iframe>`. */
  core: HTMLElement;
  /** Box of `target` before we touched anything. Presets scale from this. */
  naturalWidth: number;
  naturalHeight: number;
  /** Intrinsic ratio: `videoWidth/videoHeight` when known, else the measured box. */
  aspectRatio: number;
  kind: 'video' | 'iframe';
}

/** Ancestors that are never a sensible resize target, however tightly they fit. */
const TARGET_DENY_TAGS = new Set([
  'BODY', 'HTML', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM',
]);

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * Walk the document for `<video>` and `<iframe>` elements, descending into open
 * shadow roots and same-origin iframes. A plain `querySelectorAll` misses both,
 * which is why players inside web components or same-origin embeds never got
 * detected.
 */
export function collectMediaElements(root: Document | ShadowRoot = document): HTMLElement[] {
  const found: HTMLElement[] = [];
  const roots: (Document | ShadowRoot)[] = [root];
  let budget = DEEP_QUERY_NODE_BUDGET;

  while (roots.length > 0 && budget > 0) {
    const current = roots.shift()!;
    // A ShadowRoot has an ownerDocument; a Document is its own factory.
    const doc: Document = current.ownerDocument ?? (current as Document);
    const walker = doc.createTreeWalker(current, NodeFilter.SHOW_ELEMENT);

    let node = walker.nextNode() as Element | null;
    while (node && budget-- > 0) {
      const el = node as HTMLElement;

      if (el.id === OVERLAY_HOST_ID) {
        // Our own overlay -- skip its entire subtree.
        node = skipSubtree(walker, el);
        continue;
      }

      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
      }

      const tag = el.tagName;
      if (tag === 'VIDEO') {
        found.push(el);
      } else if (tag === 'IFRAME') {
        found.push(el);
        const frameDoc = sameOriginDocument(el as HTMLIFrameElement);
        if (frameDoc) roots.push(frameDoc);
      }

      node = walker.nextNode() as Element | null;
    }
  }

  return found;
}

function skipSubtree(walker: TreeWalker, el: Element): Element | null {
  let node = walker.nextNode() as Element | null;
  while (node && el.contains(node)) {
    node = walker.nextNode() as Element | null;
  }
  return node;
}

/** `contentDocument` throws or returns null across origins; treat both as "no access". */
function sameOriginDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    const doc = iframe.contentDocument;
    return doc && doc.body ? doc : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Visibility + scoring
// ---------------------------------------------------------------------------

export function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const view = el.ownerDocument?.defaultView ?? window;
  const style = view.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  return true;
}

function isKnownEmbed(iframe: HTMLIFrameElement): boolean {
  const src = iframe.src || iframe.getAttribute('src') || '';
  if (!src) return false;
  return EMBED_PATTERNS.some((re) => re.test(src));
}

function matchesSiteHint(el: HTMLElement): boolean {
  const hostname = window.location.hostname;
  for (const [host, selector] of Object.entries(SITE_SELECTORS)) {
    if (!hostname.includes(host)) continue;
    try {
      if (el.closest(selector)) return true;
    } catch {
      // Malformed selector -- ignore the hint rather than break detection.
    }
  }
  return false;
}

/**
 * Rank a candidate. Bigger, more on-screen, and actively playing wins. Known
 * embeds outrank anonymous iframes so an ad never beats the real player.
 */
export function scoreCandidate(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_CANDIDATE_WIDTH || rect.height < MIN_CANDIDATE_HEIGHT) return 0;
  if (!isElementVisible(el)) return 0;

  const isVideo = el.tagName === 'VIDEO';
  const ratio = rect.width / rect.height;

  if (!isVideo) {
    const iframe = el as HTMLIFrameElement;
    const known = isKnownEmbed(iframe);
    if (!known) {
      // Anonymous iframe: only plausible if it is video-shaped and reasonably big.
      // This is what keeps tweet/newsletter/ad frames out.
      if (rect.width < GENERIC_EMBED_MIN_WIDTH) return 0;
      if (ratio < GENERIC_EMBED_MIN_RATIO || ratio > GENERIC_EMBED_MAX_RATIO) return 0;
    }
  }

  const area = rect.width * rect.height;

  // How much of the element is inside the viewport right now.
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  const onScreen = area > 0 ? (visibleW * visibleH) / area : 0;

  let score = area * (0.35 + 0.65 * onScreen);

  if (isVideo) {
    const video = el as HTMLVideoElement;
    score *= 1.25;
    if (video.readyState > 0) score *= 1.2;
    if (!video.paused && !video.ended) score *= 1.6;
    if (video.muted && video.autoplay && video.loop) score *= 0.5; // background hero loop
  } else if (isKnownEmbed(el as HTMLIFrameElement)) {
    score *= 1.15;
  } else {
    score *= 0.45;
  }

  if (matchesSiteHint(el)) score *= 1.5;

  return score;
}

// ---------------------------------------------------------------------------
// Chain resolution
// ---------------------------------------------------------------------------

/**
 * Path from `el` up to the top-level `<html>`, stepping out of shadow roots via
 * their host and out of same-origin iframes via `frameElement`.
 */
export function ancestorPath(el: HTMLElement): HTMLElement[] {
  const path: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  const guard = 200;

  for (let i = 0; node && i < guard; i++) {
    path.push(node);
    let next: HTMLElement | null = node.parentElement;

    if (!next) {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        next = root.host instanceof HTMLElement ? root.host : null;
      } else {
        try {
          // Same-origin subframe: step out through the <iframe> that hosts it.
          const hostFrame: Element | null | undefined =
            node.ownerDocument?.defaultView?.frameElement;
          next = hostFrame instanceof HTMLElement ? hostFrame : null;
        } catch {
          next = null; // Cross-origin -- `frameElement` throws.
        }
      }
    }
    node = next;
  }

  return path;
}

/**
 * Pick the outermost ancestor that still tightly wraps the media element. That
 * element is what the page's layout reflows around, so resizing it (and
 * everything down to the `<video>`) is what makes the change visible.
 *
 * Climbing stops as soon as an ancestor is meaningfully bigger than the player,
 * which is what keeps us from grabbing the whole article column.
 */
export function resolveChain(core: HTMLElement): SizingChain {
  const path = ancestorPath(core);
  const coreRect = core.getBoundingClientRect();

  let targetIndex = 0;
  const maxClimb = Math.min(MAX_TARGET_CLIMB, path.length - 1);

  for (let i = 1; i <= maxClimb; i++) {
    const el = path[i];
    if (!el || TARGET_DENY_TAGS.has(el.tagName)) break;
    if (el === document.body || el === document.documentElement) break;

    const rect = el.getBoundingClientRect();
    const wrapsWidth =
      rect.width >= coreRect.width - 4 && rect.width <= coreRect.width * 1.12 + 12;
    const wrapsHeight =
      rect.height >= coreRect.height - 4 && rect.height <= coreRect.height * 1.12 + 12;

    if (!wrapsWidth || !wrapsHeight) break;
    targetIndex = i;
  }

  const target = path[targetIndex];
  // path[0] is the core, path[targetIndex - 1] is target's child. Reversing gives
  // outermost-first, which is the order `apply()` wants.
  const descendants = path.slice(0, targetIndex).reverse();

  return { target, descendants };
}

function intrinsicRatio(core: HTMLElement, box: { width: number; height: number }): number {
  if (core instanceof HTMLVideoElement || core.tagName === 'VIDEO') {
    const video = core as HTMLVideoElement;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }
  }
  if (box.width > 0 && box.height > 0) return box.width / box.height;
  return 16 / 9;
}

export function describePlayer(core: HTMLElement): DetectedPlayer {
  const chain = resolveChain(core);
  const box = measureBox(chain.target);

  return {
    ...chain,
    core,
    naturalWidth: box.width,
    naturalHeight: box.height,
    aspectRatio: intrinsicRatio(core, box),
    kind: core.tagName === 'VIDEO' ? 'video' : 'iframe',
  };
}

// ---------------------------------------------------------------------------
// Public detection API
// ---------------------------------------------------------------------------

/** Every viable player on the page, best first. */
export function findPlayers(): DetectedPlayer[] {
  return collectMediaElements()
    .map((el) => ({ el, score: scoreCandidate(el) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => describePlayer(c.el));
}

/** The single best player, or null when the page has none. */
export function detectVideoPlayer(): DetectedPlayer | null {
  const candidates = collectMediaElements()
    .map((el) => ({ el, score: scoreCandidate(el) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  return best ? describePlayer(best.el) : null;
}

/** Is this element one we would consider resizing? Used for hover-to-switch. */
export function isPlayerCandidate(el: HTMLElement): boolean {
  return scoreCandidate(el) > 0;
}

export interface PlayerObserverHandlers {
  /** A different media element became the best candidate. */
  onChange: (player: DetectedPlayer) => void;
  /** The active media element left the DOM. */
  onLost: () => void;
}

/**
 * Watch for players appearing, disappearing, or being replaced.
 *
 * Identity is the media *element*, never its measured size -- the old code keyed
 * off `tagName + offsetWidth`, so every resize looked like a brand-new player and
 * tore the overlay down mid-drag.
 */
export function observeVideoPlayers(handlers: PlayerObserverHandlers): {
  stop: () => void;
  recheck: () => void;
  current: () => DetectedPlayer | null;
  select: (core: HTMLElement) => void;
} {
  let active: DetectedPlayer | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function run(): void {
    if (stopped) return;

    if (active && !active.core.isConnected) {
      active = null;
      handlers.onLost();
    }

    const next = detectVideoPlayer();
    if (!next) return;

    if (!active || next.core !== active.core) {
      active = next;
      handlers.onChange(next);
    }
  }

  function schedule(): void {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      run();
    }, 250);
  }

  const observer = new MutationObserver((records) => {
    // Ignore anything our own overlay did.
    for (const record of records) {
      const node = record.target as HTMLElement;
      if (node?.nodeType === 1 && (node.id === OVERLAY_HOST_ID || node.closest?.(`#${OVERLAY_HOST_ID}`))) {
        continue;
      }
      schedule();
      return;
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Videos often attach their source after they are already in the DOM, which
  // produces no mutation record at all.
  const mediaEvents = ['loadedmetadata', 'play', 'canplay'] as const;
  const onMedia = () => schedule();
  for (const type of mediaEvents) {
    document.addEventListener(type, onMedia, { capture: true, passive: true });
  }

  run();

  return {
    stop() {
      stopped = true;
      if (debounce !== null) clearTimeout(debounce);
      observer.disconnect();
      for (const type of mediaEvents) {
        document.removeEventListener(type, onMedia, { capture: true });
      }
    },
    recheck: run,
    current: () => active,
    select(core: HTMLElement) {
      if (active?.core === core) return;
      active = describePlayer(core);
      handlers.onChange(active);
    },
  };
}
