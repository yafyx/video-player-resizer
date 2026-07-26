import { describe, it, expect } from 'vitest';
import { rgbToOklch, oklchToRgb, normalizeAccent, oklabDistance } from '../utils/theme';

/** Page backgrounds the accent gets compared against. */
const WHITE = rgbToOklch([255, 255, 255]);
const NEAR_BLACK = rgbToOklch([18, 18, 20]);

describe('rgbToOklch', () => {
  it('places white and black at the ends of the lightness range', () => {
    expect(rgbToOklch([255, 255, 255]).l).toBeCloseTo(1, 2);
    expect(rgbToOklch([0, 0, 0]).l).toBeCloseTo(0, 2);
  });

  it('reports greys as having no chroma', () => {
    expect(rgbToOklch([128, 128, 128]).c).toBeLessThan(0.001);
  });

  it('keeps hue stable across lightnesses of the same blue', () => {
    const light = rgbToOklch([120, 170, 255]);
    const dark = rgbToOklch([20, 60, 140]);
    // HSL drifts blue toward purple here; OKLCH is what makes this assertion hold.
    expect(Math.abs(light.h - dark.h)).toBeLessThan(10);
  });
});

describe('oklchToRgb', () => {
  it('round-trips an in-gamut colour', () => {
    const source: [number, number, number] = [61, 139, 255];
    const [r, g, b] = oklchToRgb(rgbToOklch(source));
    expect(r).toBeCloseTo(source[0], -1);
    expect(g).toBeCloseTo(source[1], -1);
    expect(b).toBeCloseTo(source[2], -1);
  });

  it('clamps an impossible chroma into sRGB instead of producing garbage', () => {
    const rgb = oklchToRgb({ l: 0.65, c: 0.9, h: 150 });
    for (const channel of rgb) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it('preserves the hue while clamping chroma', () => {
    const requested = { l: 0.65, c: 0.9, h: 150 };
    const actual = rgbToOklch(oklchToRgb(requested));
    expect(Math.abs(actual.h - requested.h)).toBeLessThan(6);
    expect(actual.c).toBeLessThan(requested.c);
  });
});

describe('normalizeAccent', () => {
  it('rejects greys, which were never a brand colour', () => {
    expect(normalizeAccent([128, 128, 128, 1], WHITE)).toBeNull();
    expect(normalizeAccent([17, 17, 17, 1], WHITE)).toBeNull();
  });

  it('rejects a mostly transparent colour', () => {
    expect(normalizeAccent([255, 0, 0, 0.3], WHITE)).toBeNull();
  });

  it('rejects a colour too close to the page background to be seen', () => {
    expect(normalizeAccent([252, 250, 255, 1], WHITE)).toBeNull();
  });

  it('lifts a very dark brand colour into the legible band', () => {
    // A navy that would disappear against a dark letterbox.
    const tuned = normalizeAccent([10, 26, 74, 1], WHITE);
    expect(tuned).not.toBeNull();
    expect(tuned!.l).toBeGreaterThanOrEqual(0.55);
    expect(tuned!.l).toBeLessThanOrEqual(0.8);
  });

  it('pulls a near-white brand colour back down', () => {
    const tuned = normalizeAccent([255, 236, 150, 1], NEAR_BLACK);
    expect(tuned).not.toBeNull();
    expect(tuned!.l).toBeLessThanOrEqual(0.8);
  });

  it('keeps the brand hue while retuning lightness', () => {
    const source = rgbToOklch([10, 26, 74]);
    const tuned = normalizeAccent([10, 26, 74, 1], WHITE);
    expect(Math.abs(tuned!.h - source.h)).toBeLessThan(1);
  });

  it('floors chroma so a muted brand still reads as a selection colour', () => {
    const tuned = normalizeAccent([120, 108, 96, 1], WHITE);
    if (tuned) expect(tuned.c).toBeGreaterThanOrEqual(0.1);
  });
});

describe('oklabDistance', () => {
  it('is zero for a colour against itself', () => {
    expect(oklabDistance(WHITE, WHITE)).toBeCloseTo(0, 6);
  });

  it('separates colours that differ only in hue', () => {
    const red = rgbToOklch([220, 40, 40]);
    const green = rgbToOklch([40, 220, 40]);
    expect(oklabDistance(red, green)).toBeGreaterThan(0.2);
  });
});
