import { describe, it, expect, beforeEach } from 'vitest';
import { computeElementPath, resolveElementPath, elementLabel } from '../utils/elementPath';

function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('computeElementPath / resolveElementPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('round-trips a plain nested element', () => {
    build('<div><section><p></p><video id=""></video></section></div>');
    const video = document.querySelector('video')!;

    const path = computeElementPath(video)!;
    expect(path).toBeTruthy();
    expect(resolveElementPath(path)).toBe(video);
  });

  it('anchors on a stable id and stops climbing there', () => {
    build('<div><main id="player-shell"><span><video></video></span></main></div>');
    const video = document.querySelector('video')!;

    const path = computeElementPath(video)!;
    expect(path.startsWith('#player-shell')).toBe(true);
    expect(resolveElementPath(path)).toBe(video);
  });

  it.each([
    ['a long digit run', 'comment-1729384512'],
    ['a build hash', 'css-a1b2c3d4e5f6'],
    ['a React useId', ':r3a:'],
  ])('ignores %s and falls back to a positional path', (_label, id) => {
    build(`<div><main><span><video></video></span></main></div>`);
    document.querySelector('main')!.id = id;
    const video = document.querySelector('video')!;

    const path = computeElementPath(video)!;
    expect(path).not.toContain(id);
    expect(resolveElementPath(path)).toBe(video);
  });

  it('ignores a duplicated id, since it cannot address one element', () => {
    build('<div><main id="dup"></main><main id="dup"><video></video></main></div>');
    const video = document.querySelector('video')!;

    const path = computeElementPath(video)!;
    expect(path).not.toContain('#dup');
    expect(resolveElementPath(path)).toBe(video);
  });

  it('distinguishes siblings of the same tag', () => {
    build('<div><video></video><video></video><video></video></div>');
    const [, second] = Array.from(document.querySelectorAll('video'));

    expect(resolveElementPath(computeElementPath(second)!)).toBe(second);
  });

  it('crosses an open shadow boundary', () => {
    build('<div><my-player></my-player></div>');
    const host = document.querySelector('my-player') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div class="wrap"><video></video></div>';
    const video = shadow.querySelector('video') as HTMLElement;

    const path = computeElementPath(video)!;
    expect(path).toContain('>>>');
    expect(resolveElementPath(path)).toBe(video);
  });

  it('refuses to address a detached element', () => {
    const orphan = document.createElement('video');
    expect(computeElementPath(orphan)).toBeNull();
  });

  it('returns null once the element the path described is gone', () => {
    build('<div><section><video></video></section></div>');
    const path = computeElementPath(document.querySelector('video')!)!;

    document.body.innerHTML = '<div></div>';
    expect(resolveElementPath(path)).toBeNull();
  });

  it('returns null rather than throwing on a malformed path', () => {
    expect(resolveElementPath('div:nth-child(')).toBeNull();
    expect(resolveElementPath('')).toBeNull();
  });

  it('returns null when a shadow segment no longer has a host', () => {
    build('<div><section><video></video></section></div>');
    // A path claiming a shadow boundary where the live DOM has none.
    expect(resolveElementPath('div:nth-child(1) >>> video:nth-child(1)')).toBeNull();
  });
});

describe('elementLabel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('names an embed by its host', () => {
    build('<iframe src="https://www.youtube.com/embed/abc"></iframe>');
    expect(elementLabel(document.querySelector('iframe')!)).toBe('iframe · youtube.com');
  });

  it('falls back to the bare tag for a src it cannot parse', () => {
    build('<iframe></iframe>');
    expect(elementLabel(document.querySelector('iframe')!)).toBe('iframe');
  });

  it('prefers an id over a class', () => {
    build('<div id="movie_player" class="html5-video-player"></div>');
    expect(elementLabel(document.querySelector('div')!)).toBe('div#movie_player');
  });

  it('skips utility-class noise for the first descriptive name', () => {
    build('<div class="w-1 h-2 player-container"></div>');
    expect(elementLabel(document.querySelector('div')!)).toBe('div.player-container');
  });

  it('degrades to the tag when nothing identifies the element', () => {
    build('<video></video>');
    expect(elementLabel(document.querySelector('video')!)).toBe('video');
  });
});
