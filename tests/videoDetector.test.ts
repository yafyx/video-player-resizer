import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isElementVisible,
  scoreCandidate,
  ancestorPath,
  resolveChain,
  collectMediaElements,
  observeVideoPlayers,
  detectVideoPlayer,
  findMediaWithin,
  describeElementTarget,
} from '../utils/videoDetector';
import { stubRect } from './helpers';

function video(box: { width: number; height: number; top?: number; left?: number }): HTMLVideoElement {
  const el = document.createElement('video');
  stubRect(el, box);
  return el;
}

function iframe(src: string, box: { width: number; height: number }) {
  const el = document.createElement('iframe');
  if (src) el.setAttribute('src', src);
  stubRect(el, box);
  return el;
}

describe('isElementVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts an element with a real box', () => {
    const el = document.createElement('div');
    stubRect(el, { width: 100, height: 100 });
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(true);
  });

  it.each([
    ['zero width', { width: '0px', height: '100px' }],
    ['zero height', { width: '100px', height: '0px' }],
  ])('rejects an element with %s', (_label, style) => {
    const el = document.createElement('div');
    Object.assign(el.style, style);
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it.each(['display', 'visibility', 'opacity'])('rejects an element hidden via %s', (prop) => {
    const el = document.createElement('div');
    stubRect(el, { width: 100, height: 100 });
    el.style.setProperty(prop, prop === 'display' ? 'none' : prop === 'visibility' ? 'hidden' : '0');
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it('rejects an element that was never laid out', () => {
    expect(isElementVisible(document.createElement('div'))).toBe(false);
  });
});

describe('scoreCandidate', () => {
  it('rejects anything below the minimum player size', () => {
    expect(scoreCandidate(video({ width: 120, height: 60 }))).toBe(0);
  });

  it('rejects an off-shape iframe such as a tweet or newsletter embed', () => {
    expect(scoreCandidate(iframe('', { width: 550, height: 800 }))).toBe(0);
  });

  it('rejects a small anonymous iframe such as an ad slot', () => {
    expect(scoreCandidate(iframe('', { width: 280, height: 200 }))).toBe(0);
  });

  it('ranks a known embed above an anonymous iframe of the same size', () => {
    const known = scoreCandidate(
      iframe('https://www.youtube.com/embed/abc123', { width: 640, height: 360 }),
    );
    const unknown = scoreCandidate(iframe('', { width: 640, height: 360 }));

    expect(known).toBeGreaterThan(0);
    expect(unknown).toBeGreaterThan(0);
    expect(known).toBeGreaterThan(unknown);
  });

  it('ranks a bigger player above a smaller one', () => {
    const big = scoreCandidate(video({ width: 960, height: 540 }));
    const small = scoreCandidate(video({ width: 400, height: 225 }));
    expect(big).toBeGreaterThan(small);
  });

  it('discounts a player scrolled mostly off screen', () => {
    const onScreen = scoreCandidate(video({ width: 640, height: 360, top: 0 }));
    const offScreen = scoreCandidate(video({ width: 640, height: 360, top: 700 }));
    expect(onScreen).toBeGreaterThan(offScreen);
  });
});

describe('collectMediaElements', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds players inside an open shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('video');
    shadow.appendChild(inner);

    expect(collectMediaElements()).toContain(inner);
  });

  it('ignores our own overlay subtree', () => {
    const overlay = document.createElement('div');
    overlay.id = 'video-resizer-overlay-root';
    overlay.appendChild(document.createElement('video'));
    document.body.appendChild(overlay);

    const decoy = document.createElement('video');
    document.body.appendChild(decoy);

    const found = collectMediaElements();
    expect(found).toContain(decoy);
    expect(found).toHaveLength(1);
  });
});

describe('resolveChain', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('climbs to the wrapper that tightly encloses the player', () => {
    document.body.innerHTML = '<div class="article"><div class="wrap"></div></div>';
    const article = document.querySelector('.article') as HTMLElement;
    const wrap = document.querySelector('.wrap') as HTMLElement;
    const frame = iframe('https://www.youtube.com/embed/abc', { width: 640, height: 360 });
    wrap.appendChild(frame);

    stubRect(wrap, { width: 640, height: 360 });
    stubRect(article, { width: 800, height: 1200 });

    const chain = resolveChain(frame);

    expect(chain.target).toBe(wrap);
    expect(chain.descendants).toEqual([frame]);
  });

  it('stops before an ancestor that holds other content', () => {
    document.body.innerHTML = '<div class="column"></div>';
    const column = document.querySelector('.column') as HTMLElement;
    const el = video({ width: 640, height: 360 });
    column.appendChild(el);

    stubRect(column, { width: 900, height: 2000 });

    const chain = resolveChain(el);

    expect(chain.target).toBe(el);
    expect(chain.descendants).toEqual([]);
  });

  it('never climbs into body', () => {
    const el = video({ width: 640, height: 360 });
    document.body.appendChild(el);
    stubRect(document.body, { width: 640, height: 360 });

    expect(resolveChain(el).target).toBe(el);
  });
});

describe('ancestorPath', () => {
  it('steps out of a shadow root through its host', () => {
    document.body.innerHTML = '<div class="host"></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    const el = document.createElement('video');
    shadow.appendChild(el);

    const path = ancestorPath(el);

    expect(path[0]).toBe(el);
    expect(path).toContain(host);
    expect(path).toContain(document.documentElement);
  });
});

describe('observeVideoPlayers', () => {
  let watcher: ReturnType<typeof observeVideoPlayers> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    watcher?.stop();
    watcher = null;
  });

  it('treats a resize as the same player, not a new one', () => {
    const el = video({ width: 640, height: 360 });
    document.body.appendChild(el);

    const onChange = vi.fn();
    watcher = observeVideoPlayers({ onChange, onLost: vi.fn() });
    expect(onChange).toHaveBeenCalledTimes(1);

    // This is the exact regression: identity used to be `tagName + offsetWidth`,
    // so growing the player looked like a brand-new one and tore down the drag.
    stubRect(el, { width: 1280, height: 720 });
    watcher.recheck();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('switches when a genuinely different element becomes the best candidate', () => {
    const first = video({ width: 640, height: 360 });
    document.body.appendChild(first);

    const onChange = vi.fn();
    watcher = observeVideoPlayers({ onChange, onLost: vi.fn() });

    const second = video({ width: 1280, height: 720 });
    document.body.appendChild(second);
    watcher.recheck();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].core).toBe(second);
  });

  it('reports the player leaving the DOM', () => {
    const el = video({ width: 640, height: 360 });
    document.body.appendChild(el);

    const onLost = vi.fn();
    watcher = observeVideoPlayers({ onChange: vi.fn(), onLost });

    el.remove();
    watcher.recheck();

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('lets the caller target a specific player', () => {
    const first = video({ width: 1280, height: 720 });
    const second = video({ width: 400, height: 225 });
    document.body.append(first, second);

    const onChange = vi.fn();
    watcher = observeVideoPlayers({ onChange, onLost: vi.fn() });
    expect(watcher.current()?.core).toBe(first);

    watcher.select(second);

    expect(watcher.current()?.core).toBe(second);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('detectVideoPlayer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns null on a page with no media', () => {
    expect(detectVideoPlayer()).toBeNull();
  });

  it('describes the player with its intrinsic ratio', () => {
    const el = video({ width: 640, height: 360 });
    Object.defineProperty(el, 'videoWidth', { value: 1920 });
    Object.defineProperty(el, 'videoHeight', { value: 1080 });
    document.body.appendChild(el);

    const player = detectVideoPlayer();

    expect(player?.core).toBe(el);
    expect(player?.kind).toBe('video');
    expect(player?.naturalWidth).toBe(640);
    expect(player?.aspectRatio).toBeCloseTo(16 / 9, 5);
  });
});

describe('findMediaWithin', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the media element inside a wrapper', () => {
    const wrap = document.createElement('div');
    const el = video({ width: 1280, height: 720 });
    wrap.appendChild(el);
    document.body.appendChild(wrap);

    expect(findMediaWithin(wrap)).toBe(el);
  });

  it('accepts the element itself when it is the media', () => {
    const el = video({ width: 1280, height: 720 });
    document.body.appendChild(el);

    expect(findMediaWithin(el)).toBe(el);
  });

  it('takes the best-scoring player when a wrapper holds several', () => {
    const wrap = document.createElement('div');
    const small = video({ width: 320, height: 180 });
    const big = video({ width: 1280, height: 720 });
    wrap.append(small, big);
    document.body.appendChild(wrap);

    expect(findMediaWithin(wrap)).toBe(big);
  });

  it('still returns a player the scorer rejects, since the user pointed at it', () => {
    const wrap = document.createElement('div');
    // Below MIN_CANDIDATE_WIDTH, so `scoreCandidate` gives it zero.
    const tiny = video({ width: 60, height: 40 });
    wrap.appendChild(tiny);
    document.body.appendChild(wrap);

    expect(findMediaWithin(tiny)).toBe(tiny);
    expect(findMediaWithin(wrap)).toBe(tiny);
  });

  it('returns null for a box with no media in it', () => {
    const wrap = document.createElement('div');
    wrap.appendChild(document.createElement('p'));
    document.body.appendChild(wrap);

    expect(findMediaWithin(wrap)).toBeNull();
  });
});

describe('describeElementTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sizes exactly the element handed to it, however loosely it wraps', () => {
    const column = document.createElement('div');
    const el = video({ width: 640, height: 360 });
    // A column far wider than the player: `resolveChain` would refuse to climb
    // here, which is the whole reason a manual pick exists.
    stubRect(column, { width: 1600, height: 900 });
    column.appendChild(el);
    document.body.appendChild(column);

    const player = describeElementTarget(column);

    expect(player.target).toBe(column);
    expect(player.naturalWidth).toBe(1600);
    expect(player.naturalHeight).toBe(900);
  });

  it('carries the size down to the media through every element between', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    const el = video({ width: 640, height: 360 });
    stubRect(outer, { width: 1600, height: 900 });
    stubRect(inner, { width: 800, height: 450 });
    inner.appendChild(el);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const player = describeElementTarget(outer);

    expect(player.core).toBe(el);
    // Outermost first, target excluded -- the order `apply()` walks.
    expect(player.descendants).toEqual([inner, el]);
  });

  it('takes the intrinsic ratio from the video, not from the box picked', () => {
    const wrap = document.createElement('div');
    const el = video({ width: 640, height: 360 });
    Object.defineProperty(el, 'videoWidth', { value: 1920 });
    Object.defineProperty(el, 'videoHeight', { value: 1080 });
    stubRect(wrap, { width: 1000, height: 200 });
    wrap.appendChild(el);
    document.body.appendChild(wrap);

    expect(describeElementTarget(wrap).aspectRatio).toBeCloseTo(16 / 9, 5);
  });

  it('reports a box holding no media as an element, with no descendants', () => {
    const wrap = document.createElement('div');
    stubRect(wrap, { width: 500, height: 300 });
    document.body.appendChild(wrap);

    const player = describeElementTarget(wrap);

    expect(player.kind).toBe('element');
    expect(player.core).toBe(wrap);
    expect(player.descendants).toEqual([]);
    expect(player.aspectRatio).toBeCloseTo(500 / 300, 5);
  });

  it('names an iframe target for what it is', () => {
    const el = iframe('https://www.youtube.com/embed/abc', { width: 800, height: 450 });
    document.body.appendChild(el);

    expect(describeElementTarget(el).kind).toBe('iframe');
  });
});
