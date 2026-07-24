export type HandlePosition = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

export interface SiteSelector {
  /** CSS selector for the video player container */
  selector: string;
  /** Whether to resize the container itself or the first matched element */
  deep: boolean;
}

export const SITE_SELECTORS: Record<string, SiteSelector> = {
  'youtube.com': { selector: '#movie_player', deep: false },
  'www.youtube.com': { selector: '#movie_player', deep: false },
  'twitch.tv': { selector: '.video-player__container', deep: false },
  'www.twitch.tv': { selector: '.video-player__container', deep: false },
  'vimeo.com': { selector: 'iframe[src*="player.vimeo.com"]', deep: false },
  'www.vimeo.com': { selector: 'iframe[src*="player.vimeo.com"]', deep: false },
};

/** Default CSS for the resize handles overlay */
export const HANDLE_SIZE = 10;
export const HANDLE_OFFSET = -5; // negative to center over the border
export const HANDLE_COLOR = '#4a9eff';
export const HANDLE_BORDER = '2px solid #ffffff';
export const HANDLE_HIT_AREA = 14; // invisible padding for easier grabbing

export const DEFAULT_SETTINGS = {
  enabled: true,
  lockAspectRatio: false,
} as const;

export const RESIZE_CURSORS: Record<HandlePosition, string> = {
  tl: 'nwse-resize',
  t: 'ns-resize',
  tr: 'nesw-resize',
  r: 'ew-resize',
  br: 'nwse-resize',
  b: 'ns-resize',
  bl: 'nesw-resize',
  l: 'ew-resize',
};

export const HANDLE_POSITIONS: HandlePosition[] = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];

/** Size presets as percentages of original size */
export const SIZE_PRESETS: { label: string; scale: number }[] = [
  { label: '50%', scale: 0.5 },
  { label: '75%', scale: 0.75 },
  { label: '100%', scale: 1.0 },
  { label: '125%', scale: 1.25 },
  { label: '150%', scale: 1.5 },
];

/** Minimum dimensions to prevent the player from collapsing */
export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 100;

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SITE_DIMENSIONS: 'siteDimensions',
  PER_SITE_DISABLED: 'perSiteDisabled',
} as const;