import { describe, it, expect } from 'vitest';
import {
  getHandleAnchor,
  applyDimensions,
  resetDimensions,
} from '../utils/resize';

describe('getHandleAnchor', () => {
  it('returns top=0, left=0 for tl', () => {
    const anchor = getHandleAnchor('tl');
    expect(anchor).toEqual({ top: '0', left: '0' });
  });

  it('returns top=0, left=50% for t', () => {
    const anchor = getHandleAnchor('t');
    expect(anchor).toEqual({ top: '0', left: '50%' });
  });

  it('returns top=0, left=100% for tr', () => {
    const anchor = getHandleAnchor('tr');
    expect(anchor).toEqual({ top: '0', left: '100%' });
  });

  it('returns top=50%, left=100% for r', () => {
    const anchor = getHandleAnchor('r');
    expect(anchor).toEqual({ top: '50%', left: '100%' });
  });

  it('returns top=100%, left=100% for br', () => {
    const anchor = getHandleAnchor('br');
    expect(anchor).toEqual({ top: '100%', left: '100%' });
  });

  it('returns top=100%, left=50% for b', () => {
    const anchor = getHandleAnchor('b');
    expect(anchor).toEqual({ top: '100%', left: '50%' });
  });

  it('returns top=100%, left=0 for bl', () => {
    const anchor = getHandleAnchor('bl');
    expect(anchor).toEqual({ top: '100%', left: '0' });
  });

  it('returns top=50%, left=0 for l', () => {
    const anchor = getHandleAnchor('l');
    expect(anchor).toEqual({ top: '50%', left: '0' });
  });
});

describe('applyDimensions', () => {
  it('sets width, height, and clears transform on an element', () => {
    const el = document.createElement('div');
    el.style.transform = 'translate(10px, 20px)';
    applyDimensions(el, 500, 300);
    expect(el.style.width).toBe('500px');
    expect(el.style.height).toBe('300px');
    expect(el.style.transform).toBe('');
  });

  it('accepts zero dimensions', () => {
    const el = document.createElement('div');
    applyDimensions(el, 0, 0);
    expect(el.style.width).toBe('0px');
    expect(el.style.height).toBe('0px');
  });
});

describe('resetDimensions', () => {
  it('clears width, height, transform, and position', () => {
    const el = document.createElement('div');
    el.style.width = '500px';
    el.style.height = '300px';
    el.style.transform = 'translate(10px, 10px)';
    el.style.position = 'relative';
    resetDimensions(el);
    expect(el.style.width).toBe('');
    expect(el.style.height).toBe('');
    expect(el.style.transform).toBe('');
    expect(el.style.position).toBe('');
  });
});