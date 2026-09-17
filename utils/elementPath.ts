/**
 * Addressing and naming individual elements.
 *
 * A manually picked target has to survive a reload, which means turning a live
 * node into a string and back. There is no perfect answer -- pages re-render and
 * inject nodes between visits -- so the contract here is deliberately modest:
 * resolve the same element when the page still looks the same, and return `null`
 * the moment it does not, so the caller can fall back to automatic detection.
 *
 * Paths anchor on an id wherever a stable-looking one exists and fall back to
 * `:nth-child()` chains. Shadow boundaries are encoded as separate segments,
 * because a selector cannot cross one.
 */

const SHADOW_SEP = ' >>> ';

/** Enough hops to leave any real component tree; a cycle would stop here too. */
const MAX_ROOT_HOPS = 20;

/**
 * Ids that carry a build hash, a database key, or a framework counter change on
 * every render, so anchoring to one would be worse than a positional path.
 */
function isStableId(id: string): boolean {
  if (!id || id.length > 64) return false;
  if (/\d{4,}/.test(id)) return false; // comment-1729384512
  if (/[0-9a-f]{12,}/i.test(id)) return false; // emotion / webpack hashes
  if (/^:r[0-9a-z]+:$/i.test(id)) return false; // React `useId`
  return true;
}

/**
 * `CSS.escape`, with a fallback. Keeping the fallback means this module stays
 * pure DOM-and-strings rather than depending on one more browser global.
 */
function escapeIdent(value: string): string {
  const native = window.CSS?.escape;
  if (typeof native === 'function') return native.call(window.CSS, value);

  return value
    .replace(/[^\w-]/g, (ch) => `\\${ch}`)
    .replace(/^(\d)/, '\\3$1 '); // A leading digit needs the numeric form: `\31 `.
}

function childIndex(el: Element): number {
  const siblings = el.parentNode?.children;
  if (!siblings) return 1;
  return Array.prototype.indexOf.call(siblings, el) + 1;
}

/** `#id`, but only when it is stable *and* unique inside its own root. */
function stableIdSelector(el: Element): string | null {
  if (!isStableId(el.id)) return null;

  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.querySelectorAll !== 'function') return null;

  const selector = `#${escapeIdent(el.id)}`;
  try {
    if (root.querySelectorAll(selector).length !== 1) return null;
  } catch {
    return null;
  }
  return selector;
}

/**
 * Selector for `el` relative to its own root, walking up until an id anchors the
 * path or we run out of parents (the document element, or the top of a shadow
 * tree -- both have a null `parentElement`).
 */
function pathWithinRoot(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;

  for (let i = 0; node && i < 100; i++) {
    const anchor = stableIdSelector(node);
    if (anchor) {
      parts.unshift(anchor);
      break;
    }
    parts.unshift(`${node.localName}:nth-child(${childIndex(node)})`);
    node = node.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Turn an element into a string we can store. Returns `null` for anything we
 * cannot address from the top document -- a node inside a same-origin subframe,
 * or one that has already been detached.
 */
export function computeElementPath(el: HTMLElement): string | null {
  if (!el.isConnected) return null;

  const segments: string[] = [];
  let node: Element | null = el;

  for (let i = 0; node && i < MAX_ROOT_HOPS; i++) {
    const root = node.getRootNode();

    if (root instanceof ShadowRoot) {
      segments.unshift(pathWithinRoot(node));
      node = root.host;
      continue;
    }

    // A subframe document, or a detached tree: no address from here.
    if (root !== document) return null;

    segments.unshift(pathWithinRoot(node));
    return segments.join(SHADOW_SEP);
  }

  return null;
}

/** Resolve a path from `computeElementPath`. Null whenever the page has moved on. */
export function resolveElementPath(path: string): HTMLElement | null {
  const segments = path.split(SHADOW_SEP).filter(Boolean);
  if (segments.length === 0) return null;

  let root: Document | ShadowRoot = document;
  let found: HTMLElement | null = null;

  for (let i = 0; i < segments.length; i++) {
    let el: Element | null;
    try {
      el = root.querySelector(segments[i]);
    } catch {
      return null; // Written by a different build, or rejected by this engine.
    }

    if (!(el instanceof HTMLElement)) return null;

    if (i === segments.length - 1) {
      found = el;
      break;
    }

    // Every segment but the last has to be a shadow host.
    if (!el.shadowRoot) return null;
    root = el.shadowRoot;
  }

  return found?.isConnected ? found : null;
}

/**
 * Short human name for an element, for the popup and the picker badge:
 * `video`, `div.player-wrap`, `iframe · youtube.com`.
 */
export function elementLabel(el: HTMLElement): string {
  const tag = el.localName;

  if (tag === 'iframe') {
    // An empty src would resolve against the page and name the host page itself.
    const src = (el as HTMLIFrameElement).src || el.getAttribute('src') || '';
    if (src) {
      try {
        const host = new URL(src, window.location.href).hostname.replace(/^www\./, '');
        if (host) return `iframe · ${host}`;
      } catch {
        // `about:blank`, or a `javascript:` src.
      }
    }
    return 'iframe';
  }

  if (el.id && el.id.length <= 24) return `${tag}#${el.id}`;

  // Utility-class soup buries the one descriptive name among a dozen `w-1`s.
  // Longest-wins picks it out without having to know the framework.
  const cls = Array.from(el.classList)
    .filter((c) => c.length > 2 && c.length <= 20)
    .sort((a, b) => b.length - a.length)[0];

  return cls ? `${tag}.${cls}` : tag;
}
