import { MAX_OVERFLOW_CLIMB } from './constants';

/**
 * Making an element a specific pixel size on an arbitrary site is harder than
 * setting `style.width`. Real pages fight back in four ways:
 *
 *   1. `!important` rules and utility classes that pin `width: 100%`.
 *   2. `max-width: 100%` / `min-height: …` clamps that silently cap our value.
 *   3. Intrinsic-ratio boxes -- either the classic `padding-bottom: 56.25%`
 *      hack (the element's own `height` computes to 0) or a modern
 *      `aspect-ratio: 16 / 9`. Setting `height` on those does nothing.
 *   4. Clipping ancestors, so a player that grows past its column is cut off
 *      and looks like nothing happened.
 *
 * This module writes every property with `important`, neutralises each of those
 * mechanisms, and records the exact inline value it displaced so `restore()`
 * puts the page back byte-for-byte.
 */

type Priority = '' | 'important';

/** `object-fit` values that mean the page made a real choice we should respect. */
const DELIBERATE_OBJECT_FIT = new Set(['contain', 'cover', 'none', 'scale-down']);

interface SavedProp {
  el: HTMLElement;
  prop: string;
  value: string;
  priority: Priority;
}

export interface SizingSession {
  /** Force the whole chain to `width` x `height` CSS pixels. */
  apply(width: number, height: number): void;
  /** Undo every style this session wrote. Idempotent. */
  restore(): void;
  /** True once `apply` has written anything. */
  readonly isApplied: boolean;
}

export interface SizingChain {
  /** Outermost element we resize -- the one the page reflows around. */
  target: HTMLElement;
  /**
   * Elements from just inside `target` down to and including the media element
   * itself. Each is forced to the same box so the size actually reaches the
   * `<video>` instead of stopping at a wrapper.
   */
  descendants: HTMLElement[];
}

export interface SizingOptions {
  /** Unclip ancestors when the player outgrows them. */
  allowOverflow: boolean;
}

export function createSizingSession(
  chain: SizingChain,
  options: SizingOptions,
): SizingSession {
  const saved: SavedProp[] = [];
  const seen = new Set<string>();
  let applied = false;

  function force(el: HTMLElement, prop: string, value: string): void {
    // Remember the *first* value we displaced for each element/property pair,
    // so repeated drags don't overwrite the page's original with our own.
    const key = `${elementKey(el)}|${prop}`;
    if (!seen.has(key)) {
      seen.add(key);
      saved.push({
        el,
        prop,
        value: el.style.getPropertyValue(prop),
        priority: el.style.getPropertyPriority(prop) as Priority,
      });
    }
    el.style.setProperty(prop, value, 'important');
  }

  const keys = new WeakMap<HTMLElement, string>();
  let keySeq = 0;
  function elementKey(el: HTMLElement): string {
    let k = keys.get(el);
    if (!k) {
      k = String(++keySeq);
      keys.set(el, k);
    }
    return k;
  }

  /** Strip everything that would clamp or override an explicit pixel box. */
  function unclamp(el: HTMLElement): void {
    const cs = getComputedStyle(el);

    force(el, 'box-sizing', 'border-box');
    force(el, 'max-width', 'none');
    force(el, 'max-height', 'none');
    force(el, 'min-width', '0');
    force(el, 'min-height', '0');

    // Modern intrinsic-ratio boxes ignore an explicit height.
    if (cs.aspectRatio && cs.aspectRatio !== 'auto') {
      force(el, 'aspect-ratio', 'auto');
    }

    // `padding-bottom: 56.25%` hack: the box is made entirely of padding, so the
    // element's own height computes to 0 and setting `height` is a no-op.
    const ownHeight = parseFloat(cs.height) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const padTop = parseFloat(cs.paddingTop) || 0;
    if (ownHeight < 1 && padBottom + padTop > 1) {
      force(el, 'padding-bottom', '0px');
      force(el, 'padding-top', '0px');
    }

    // An inline box ignores width/height entirely.
    if (cs.display === 'inline') {
      force(el, 'display', 'inline-block');
    }
  }

  /** Keep a flex/grid parent from stretching or shrinking our explicit box. */
  function pinInParentLayout(el: HTMLElement): void {
    const parent = el.parentElement;
    if (!parent) return;
    const pd = getComputedStyle(parent).display;
    if (pd === 'flex' || pd === 'inline-flex') {
      force(el, 'flex', 'none');
    } else if (pd === 'grid' || pd === 'inline-grid') {
      force(el, 'justify-self', 'start');
      force(el, 'align-self', 'start');
    }
  }

  /**
   * Let the player spill out of a narrow column. We only touch ancestors that
   * actually clip on the overflowing axis, and we never touch a real scroll
   * container -- taking `overflow` away from one would break the page's scrolling.
   */
  function relaxOverflow(width: number, height: number): void {
    let el: HTMLElement | null = chain.target.parentElement;
    for (let i = 0; i < MAX_OVERFLOW_CLIMB && el; i++) {
      if (el === document.body || el === document.documentElement) break;

      const cs = getComputedStyle(el);
      const scrollsX = el.scrollWidth > el.clientWidth + 4;
      const scrollsY = el.scrollHeight > el.clientHeight + 4;

      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';

      if (clipsX && width > el.clientWidth && !scrollsX) {
        force(el, 'overflow-x', 'visible');
      }
      if (clipsY && height > el.clientHeight && !scrollsY) {
        force(el, 'overflow-y', 'visible');
      }

      el = el.parentElement;
    }
  }

  return {
    get isApplied() {
      return applied;
    },

    apply(width: number, height: number): void {
      applied = true;
      const w = Math.round(width);
      const h = Math.round(height);

      unclamp(chain.target);
      pinInParentLayout(chain.target);
      force(chain.target, 'width', `${w}px`);
      force(chain.target, 'height', `${h}px`);

      for (const el of chain.descendants) {
        if (!el.isConnected) continue;
        unclamp(el);
        force(el, 'width', `${w}px`);
        force(el, 'height', `${h}px`);

        // Never distort the picture when the ratio is unlocked -- letterbox
        // instead. Phrased as "unless the page asked for something specific", so
        // an unreadable or missing computed value still gets the safe default.
        if (el instanceof HTMLVideoElement || el.tagName === 'VIDEO') {
          if (!DELIBERATE_OBJECT_FIT.has(getComputedStyle(el).objectFit)) {
            force(el, 'object-fit', 'contain');
          }
        }
      }

      if (options.allowOverflow) {
        relaxOverflow(w, h);
      }
    },

    restore(): void {
      // Reverse order so nested writes unwind cleanly.
      for (let i = saved.length - 1; i >= 0; i--) {
        const { el, prop, value, priority } = saved[i];
        el.style.removeProperty(prop);
        if (value) {
          el.style.setProperty(prop, value, priority || '');
        }
      }
      saved.length = 0;
      seen.clear();
      applied = false;
    },
  };
}

/**
 * Read an element's box without our own styles interfering. Used to capture the
 * player's "natural" size before the first `apply()`.
 */
export function measureBox(el: HTMLElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    width: Math.round(rect.width) || el.offsetWidth || 0,
    height: Math.round(rect.height) || el.offsetHeight || 0,
  };
}
