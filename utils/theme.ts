import { ACCENT } from './constants';

/**
 * The overlay borrows the page's own accent colour so it reads as part of the
 * site rather than as a foreign widget bolted on top.
 *
 * A brand colour is chosen to sit on that site's background, not on an arbitrary
 * frame of video, so we never use it raw. Everything is normalised in OKLCH: the
 * hue -- the part that actually carries the brand -- survives untouched, while
 * lightness is pulled into a band that stays legible over both a black letterbox
 * and a white sky, and chroma is floored so a muted brand still reads as a
 * selection colour rather than as grey.
 */
export interface OverlayTheme {
  /** Frame line, handle border, badge fill. Always an sRGB hex. */
  accent: string;
  /** The same colour in `oklch()`, applied only where the browser supports it. */
  accentOklch: string;
  /** Accent at low alpha, for the halo around a grabbed handle. */
  accentSoft: string;
  /** Text drawn on top of `accent`. */
  onAccent: string;
  /** One-pixel separation ring outside the frame line. */
  halo: string;
  scheme: 'light' | 'dark';
  /** True when the colour came from the page rather than from our fallback. */
  fromSite: boolean;
}

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/**
 * A selection frame has to survive being drawn over unknown video. Below ~0.55 it
 * disappears into dark scenes; above ~0.80 it washes out against bright ones.
 */
const MIN_LIGHTNESS = 0.55;
const MAX_LIGHTNESS = 0.8;
/** Below this the colour reads as grey and stops looking deliberate. */
const MIN_CHROMA = 0.1;
/** Anything this flat was never a brand colour to begin with. */
const GREY_CHROMA = 0.035;
/** Oklab distance below which the accent vanishes into the page background. */
const MIN_BACKGROUND_DISTANCE = 0.12;
/** OKLCH lightness above which dark text beats white on the badge. */
const ON_ACCENT_FLIP = 0.68;

/** Custom properties that sites conventionally use for their brand colour. */
const ACCENT_VARS = [
  '--accent',
  '--accent-color',
  '--color-accent',
  '--primary',
  '--primary-color',
  '--color-primary',
  '--brand',
  '--brand-color',
  '--color-brand',
  '--theme-color',
  '--link-color',
  '--color-link',
];

const CSS_WIDE_KEYWORDS =
  /^(inherit|initial|unset|revert|revert-layer|currentcolor|transparent|auto|none)$/i;

// ---------------------------------------------------------------------------
// OKLCH
// ---------------------------------------------------------------------------

function srgbToLinear(channel: number): number {
  const x = channel / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return v * 255;
}

export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.hypot(okA, okB);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;

  return { l: okL, c: chroma, h: hue };
}

function oklchToRawRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const okA = c * Math.cos(rad);
  const okB = c * Math.sin(rad);

  const lc = (l + 0.3963377774 * okA + 0.2158037573 * okB) ** 3;
  const mc = (l - 0.1055613458 * okA - 0.0638541728 * okB) ** 3;
  const sc = (l - 0.0894841775 * okA - 1.291485548 * okB) ** 3;

  return [
    linearToSrgb(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    linearToSrgb(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    linearToSrgb(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  ];
}

function inSrgbGamut([r, g, b]: Rgb): boolean {
  const tolerance = 0.5;
  return [r, g, b].every((v) => v >= -tolerance && v <= 255 + tolerance);
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Not every OKLCH triple is displayable. Reduce chroma -- never lightness, never
 * hue -- until the colour fits sRGB, so the brand hue survives the trip.
 */
export function oklchToRgb(colour: Oklch): Rgb {
  const direct = oklchToRawRgb(colour);
  if (inSrgbGamut(direct)) return direct.map(clamp255) as Rgb;

  let low = 0;
  let high = colour.c;
  let best = oklchToRawRgb({ ...colour, c: 0 });

  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    const candidate = oklchToRawRgb({ ...colour, c: mid });
    if (inSrgbGamut(candidate)) {
      best = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }

  return best.map(clamp255) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function toOklchString({ l, c, h }: Oklch): string {
  const trim = (value: number, places: number) => Number(value.toFixed(places)).toString();
  return `oklch(${trim(l, 3)} ${trim(c, 3)} ${trim(h, 2)})`;
}

/** Perceptual distance, so "too close to see" means what it says. */
export function oklabDistance(a: Oklch, b: Oklch): number {
  const ax = a.c * Math.cos((a.h * Math.PI) / 180);
  const ay = a.c * Math.sin((a.h * Math.PI) / 180);
  const bx = b.c * Math.cos((b.h * Math.PI) / 180);
  const by = b.c * Math.sin((b.h * Math.PI) / 180);
  return Math.hypot(a.l - b.l, ax - bx, ay - by);
}

// ---------------------------------------------------------------------------
// Reading colour out of the page
// ---------------------------------------------------------------------------

function parseRgba(value: string): Rgba | null {
  const match = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;

  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);

  if (parts.length < 3) return null;
  if (parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;

  const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
  return [parts[0], parts[1], parts[2], alpha];
}

/**
 * Let the engine resolve any CSS colour notation for us. The probe lives inside
 * the overlay's shadow root, so nothing on the page can style it out from under us.
 */
function normalize(value: string, probe: HTMLElement): Rgba | null {
  const trimmed = value.trim();
  if (!trimmed || CSS_WIDE_KEYWORDS.test(trimmed)) return null;

  const direct = parseRgba(trimmed);
  if (direct) return direct;

  probe.style.removeProperty('color');
  probe.style.color = trimmed;
  // CSSOM silently drops anything invalid, including bare token lists such as
  // Tailwind's `220 90% 56%`.
  if (!probe.style.color) return null;

  return parseRgba(getComputedStyle(probe).color);
}

function pageBackground(probe: HTMLElement): Rgb {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const colour = parseRgba(getComputedStyle(el).backgroundColor);
    if (colour && colour[3] > 0.5) return [colour[0], colour[1], colour[2]];
  }
  // An unpainted page shows the browser canvas, which follows the user's colour
  // scheme rather than being reliably white.
  const canvas = normalize('Canvas', probe);
  return canvas ? [canvas[0], canvas[1], canvas[2]] : [255, 255, 255];
}

/** The colour most of the page's links share is a good proxy for its accent. */
function rankedLinkColours(): string[] {
  const tally = new Map<string, number>();

  for (const anchor of Array.from(document.querySelectorAll('a[href]')).slice(0, 24)) {
    if (!(anchor instanceof HTMLElement)) continue;
    const colour = getComputedStyle(anchor).color;
    tally.set(colour, (tally.get(colour) ?? 0) + 1);
  }

  return Array.from(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([colour]) => colour);
}

/** Ordered best guesses: declared brand colour first, inferred last. */
export function accentCandidates(): string[] {
  const candidates: string[] = [];

  const meta = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
  if (meta) candidates.push(meta);

  const root = getComputedStyle(document.documentElement);
  for (const name of ACCENT_VARS) {
    const value = root.getPropertyValue(name).trim();
    if (value) candidates.push(value);
  }

  const declared = root.accentColor;
  if (declared && declared !== 'auto') candidates.push(declared);

  candidates.push(...rankedLinkColours());

  return candidates;
}

/**
 * Keep the hue, force everything else into a range that works on top of video.
 * Returns null for colours that were never usable as an accent.
 */
export function normalizeAccent(colour: Rgba, background: Oklch): Oklch | null {
  if (colour[3] < 0.6) return null;

  const source = rgbToOklch([colour[0], colour[1], colour[2]]);
  if (source.c < GREY_CHROMA) return null;

  const tuned: Oklch = {
    h: source.h,
    l: Math.min(Math.max(source.l, MIN_LIGHTNESS), MAX_LIGHTNESS),
    c: Math.max(source.c, MIN_CHROMA),
  };

  if (oklabDistance(tuned, background) < MIN_BACKGROUND_DISTANCE) return null;

  return tuned;
}

export function deriveOverlayTheme(probe: HTMLElement): OverlayTheme {
  const background = rgbToOklch(pageBackground(probe));
  const scheme: 'light' | 'dark' = background.l < 0.5 ? 'dark' : 'light';

  let accent: Oklch | null = null;
  for (const candidate of accentCandidates()) {
    const parsed = normalize(candidate, probe);
    if (!parsed) continue;
    accent = normalizeAccent(parsed, background);
    if (accent) break;
  }

  const fromSite = accent !== null;
  if (!accent) {
    const fallback = normalize(ACCENT, probe);
    accent = fallback
      ? rgbToOklch([fallback[0], fallback[1], fallback[2]])
      : { l: 0.652, c: 0.176, h: 258 };
  }

  // Round-trip through sRGB so the hex and the oklch() string name the same
  // colour even after gamut clamping.
  const rgb = oklchToRgb(accent);

  return {
    accent: toHex(rgb),
    accentOklch: toOklchString(rgbToOklch(rgb)),
    // Pre-computed rather than `color-mix()`, which would invalidate the whole
    // box-shadow declaration on browsers that do not support it.
    accentSoft: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.26)`,
    onAccent: accent.l > ON_ACCENT_FLIP ? '#101114' : '#ffffff',
    // A dark separation ring is invisible on a dark page, so flip it.
    halo: scheme === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.28)',
    scheme,
    fromSite,
  };
}
