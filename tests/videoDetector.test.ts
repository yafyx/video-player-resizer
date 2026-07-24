import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isElementVisible } from '../utils/videoDetector';

describe('isElementVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns true for a visible element', () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '100px';
    document.body.appendChild(el);
    // getBoundingClientRect returns 0,0,100,100 since it's in DOM
    expect(isElementVisible(el)).toBe(true);
  });

  it('returns false when element has zero width', () => {
    const el = document.createElement('div');
    el.style.width = '0px';
    el.style.height = '100px';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it('returns false when element has zero height', () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '0px';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it('returns false when display is none', () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '100px';
    el.style.display = 'none';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it('returns false when visibility is hidden', () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '100px';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it('returns false when opacity is 0', () => {
    const el = document.createElement('div');
    el.style.width = '100px';
    el.style.height = '100px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  it('returns true when element is not in the DOM (no bounding rect)', () => {
    // Element not appended to DOM has 0 bounding rect
    const el = document.createElement('div');
    expect(isElementVisible(el)).toBe(false);
  });
});