export type HandlePosition = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

export const HANDLE_POSITIONS: HandlePosition[] = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
export const CORNER_HANDLES: HandlePosition[] = ['tl', 'tr', 'br', 'bl'];
export const EDGE_HANDLES: HandlePosition[] = ['t', 'r', 'b', 'l'];

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

/** Which axes a given handle drives. */
export const HANDLE_AXES: Record<HandlePosition, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  tl: { x: -1, y: -1 },
  t: { x: 0, y: -1 },
  tr: { x: 1, y: -1 },
  r: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  b: { x: 0, y: 1 },
  bl: { x: -1, y: 1 },
  l: { x: -1, y: 0 },
};

export const HANDLE_LABELS: Record<HandlePosition, string> = {
  tl: 'top left corner',
  t: 'top edge',
  tr: 'top right corner',
  r: 'right edge',
  br: 'bottom right corner',
  b: 'bottom edge',
  bl: 'bottom left corner',
  l: 'left edge',
};

/**
 * Iframe sources that are known video players. Matched against the resolved
 * `src` of every iframe in the document.
 */
export const EMBED_PATTERNS: RegExp[] = [
  /(?:^|\.)youtube(?:-nocookie)?\.com\/(?:embed|v|shorts)\//i,
  /(?:^|\.)youtu\.be\//i,
  /player\.vimeo\.com\//i,
  /(?:player|embed|clips)\.twitch\.tv\//i,
  /player\.kick\.com\//i,
  /(?:^|\.)dailymotion\.com\/embed\//i,
  /streamable\.com\/[eos]\//i,
  /rumble\.com\/embed\//i,
  /(?:^|\.)facebook\.com\/plugins\/video/i,
  /(?:fast\.)?wistia\.(?:net|com)\/embed\//i,
  /players\.brightcove\.net\//i,
  /(?:^|\.)jwplayer\.com\//i,
  /iframe\.mediadelivery\.net\//i,
  /(?:^|\.)loom\.com\/embed\//i,
  /drive\.google\.com\/file\/[^/]+\/[^/]+\/preview/i,
  /archive\.org\/embed\//i,
  /odysee\.com\/\$\/embed\//i,
  /(?:^|\.)vk\.com\/video_ext/i,
  /(?:^|\.)ok\.ru\/videoembed\//i,
  /player\.bilibili\.com\//i,
  /embed\.nicovideo\.jp\//i,
  /(?:^|\.)bitchute\.com\/embed\//i,
  /(?:^|\.)redgifs\.com\/ifr\//i,
  /iframe\.videodelivery\.net\//i,
  /(?:^|\.)cloudflarestream\.com\//i,
];

/**
 * Site-specific hints. These *boost* a candidate's score rather than short-circuit
 * detection, so a bad selector can never make the extension worse than the
 * generic path.
 */
export const SITE_SELECTORS: Record<string, string> = {
  'youtube.com': '#movie_player',
  'twitch.tv': '.video-player__container, [data-a-target="video-player"]',
  'vimeo.com': '.player, iframe[src*="player.vimeo.com"]',
  'dailymotion.com': '.player-container',
};

/** Smallest box we will consider a real player, and the floor for resizing. */
export const MIN_CANDIDATE_WIDTH = 160;
export const MIN_CANDIDATE_HEIGHT = 90;
export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 112;

/** Distance in px within which a drag snaps to a meaningful size. */
export const SNAP_THRESHOLD = 12;

/** Plausible aspect ratios for an unlabelled iframe to be treated as a player. */
export const GENERIC_EMBED_MIN_RATIO = 1.3;
export const GENERIC_EMBED_MAX_RATIO = 2.6;
export const GENERIC_EMBED_MIN_WIDTH = 300;

/** How far up the ancestor chain we look for the element that actually sizes the player. */
export const MAX_TARGET_CLIMB = 6;

/** How far up we look for clipping ancestors when the player outgrows its column. */
export const MAX_OVERFLOW_CLIMB = 8;

/** Node budget for the shadow-DOM-piercing document walk. */
export const DEEP_QUERY_NODE_BUDGET = 25_000;

export const SIZE_PRESETS: { label: string; scale: number }[] = [
  { label: '75%', scale: 0.75 },
  { label: '100%', scale: 1 },
  { label: '125%', scale: 1.25 },
  { label: '150%', scale: 1.5 },
  { label: '200%', scale: 2 },
];

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SITE_DIMENSIONS: 'siteDimensions',
  /**
   * Per site: `true` means the user turned resize on for that host. Absent (or
   * `false`) means off, which is the default for every site until asked for.
   */
  PER_SITE_OVERRIDES: 'perSiteOverrides',
} as const;

export const DEFAULT_SETTINGS = {
  /** Master switch. Per-site disable is stored separately. */
  enabled: true,
  /** Constrain drags to the player's intrinsic ratio. Shift inverts this per-drag. */
  lockAspectRatio: true,
  /** Unclip ancestors so the player can grow past its column. */
  allowOverflow: true,
  /** Remember the size per site and re-apply it on the next visit. */
  rememberSize: true,
} as const;

/** Overlay accent, shared with the popup so both read as one product. */
export const ACCENT = '#3d8bff';

/** Id of the overlay root we append to <html>. Also used to ignore our own mutations. */
export const OVERLAY_HOST_ID = 'video-resizer-overlay-root';
