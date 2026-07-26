import { describe, it, expect, beforeEach } from 'vitest';
import { createSizingSession, measureBox } from '../utils/sizing';
import { stubRect } from './helpers';

/** Fixture markup only -- these strings are literals in this file. */
function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('createSizingSession', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('writes every size property with !important so page CSS cannot win', () => {
    const target = build('<div></div>');
    const session = createSizingSession({ target, descendants: [] }, { allowOverflow: false });

    session.apply(800, 450);

    expect(target.style.getPropertyValue('width')).toBe('800px');
    expect(target.style.getPropertyPriority('width')).toBe('important');
    expect(target.style.getPropertyPriority('height')).toBe('important');
    expect(target.style.getPropertyValue('max-width')).toBe('none');
    // CSSOM serialises a bare `0` length back out as `0px`.
    expect(parseFloat(target.style.getPropertyValue('min-width'))).toBe(0);
    expect(target.style.getPropertyValue('box-sizing')).toBe('border-box');
  });

  it('sizes the media element itself, not just the wrapper', () => {
    const target = build('<div><div class="inner"><video></video></div></div>');
    const inner = target.querySelector('.inner') as HTMLElement;
    const video = target.querySelector('video') as HTMLElement;

    const session = createSizingSession(
      { target, descendants: [inner, video] },
      { allowOverflow: false },
    );
    session.apply(1024, 576);

    for (const el of [target, inner, video]) {
      expect(el.style.getPropertyValue('width')).toBe('1024px');
      expect(el.style.getPropertyValue('height')).toBe('576px');
    }
  });

  it('letterboxes instead of stretching when the ratio is unlocked', () => {
    // Stated explicitly: `fill` is the CSS initial value, but jsdom reports the
    // unset computed value as `contain`, which would mask the branch under test.
    const target = build('<div><video style="object-fit: fill"></video></div>');
    const video = target.querySelector('video') as HTMLElement;

    createSizingSession({ target, descendants: [video] }, { allowOverflow: false }).apply(900, 300);

    expect(video.style.getPropertyValue('object-fit')).toBe('contain');
  });

  it('respects a fit the page chose deliberately', () => {
    const target = build('<div><video style="object-fit: cover"></video></div>');
    const video = target.querySelector('video') as HTMLElement;

    createSizingSession({ target, descendants: [video] }, { allowOverflow: false }).apply(900, 300);

    expect(video.style.getPropertyValue('object-fit')).toBe('cover');
  });

  it('neutralises the padding-bottom ratio hack, which otherwise ignores height', () => {
    const target = build('<div style="height: 0; padding-bottom: 56.25%"></div>');

    createSizingSession({ target, descendants: [] }, { allowOverflow: false }).apply(800, 450);

    expect(target.style.getPropertyValue('padding-bottom')).toBe('0px');
    expect(target.style.getPropertyPriority('padding-bottom')).toBe('important');
    expect(target.style.getPropertyValue('height')).toBe('450px');
  });

  it('leaves ordinary padding alone', () => {
    const target = build('<div style="height: 200px; padding-bottom: 20px"></div>');

    createSizingSession({ target, descendants: [] }, { allowOverflow: false }).apply(800, 450);

    expect(target.style.getPropertyValue('padding-bottom')).toBe('20px');
  });

  it('promotes an inline box so width and height are not ignored', () => {
    const target = build('<span></span>');

    createSizingSession({ target, descendants: [] }, { allowOverflow: false }).apply(400, 225);

    expect(target.style.getPropertyValue('display')).toBe('inline-block');
  });

  it('pins the element against a flex parent that would stretch it', () => {
    document.body.innerHTML = '<div style="display: flex"><div class="t"></div></div>';
    const target = document.querySelector('.t') as HTMLElement;

    createSizingSession({ target, descendants: [] }, { allowOverflow: false }).apply(400, 225);

    // CSSOM expands the `none` shorthand to its longhands on the way back out.
    expect(['none', '0 0 auto']).toContain(target.style.getPropertyValue('flex'));
  });

  it('restores the page byte-for-byte, including pre-existing inline values', () => {
    const target = build('<div style="width: 320px; max-width: 100%; color: red"></div>');
    const session = createSizingSession({ target, descendants: [] }, { allowOverflow: false });

    session.apply(800, 450);
    session.apply(1000, 562); // a second drag frame must not overwrite the original
    session.restore();

    expect(target.style.getPropertyValue('width')).toBe('320px');
    expect(target.style.getPropertyPriority('width')).toBe('');
    expect(target.style.getPropertyValue('max-width')).toBe('100%');
    expect(target.style.getPropertyValue('color')).toBe('red');
    expect(target.style.getPropertyValue('min-width')).toBe('');
    expect(session.isApplied).toBe(false);
  });

  it('reports whether anything has been applied', () => {
    const target = build('<div></div>');
    const session = createSizingSession({ target, descendants: [] }, { allowOverflow: false });

    expect(session.isApplied).toBe(false);
    session.apply(800, 450);
    expect(session.isApplied).toBe(true);
  });
});

describe('measureBox', () => {
  it('reads the rendered box', () => {
    const el = document.createElement('div');
    stubRect(el, { width: 640.4, height: 360.2 });
    expect(measureBox(el)).toEqual({ width: 640, height: 360 });
  });
});
