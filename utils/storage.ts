import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';

export interface ExtensionSettings {
  enabled: boolean;
  lockAspectRatio: boolean;
  allowOverflow: boolean;
  rememberSize: boolean;
}

export interface StoredDimensions {
  width: number;
  height: number;
}

export type SiteDimensions = Record<string, StoredDimensions>;

/** `true` the user switched it on here, `false` off. Absent means "use the default". */
export type SiteOverrides = Record<string, boolean>;

/**
 * `element` sizes exactly the node the user picked; `player` treats it as a media
 * element and lets `resolveChain` find the box around it, the same way automatic
 * detection would.
 */
export type PickMode = 'element' | 'player';

export interface StoredPick {
  /** Address of the chosen element, resolvable by `resolveElementPath`. */
  path: string;
  mode: PickMode;
}

export type SitePicks = Record<string, StoredPick>;

const {
  SETTINGS: SETTINGS_KEY,
  SITE_DIMENSIONS: SITE_DIMENSIONS_KEY,
  PER_SITE_OVERRIDES: PER_SITE_OVERRIDES_KEY,
  SITE_PICKS: SITE_PICKS_KEY,
} = STORAGE_KEYS;

/**
 * Always merged over the defaults, so adding a setting in a later version can
 * never leave an existing install with an `undefined` field.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.sync.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function setSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const merged = { ...(await getSettings()), ...settings };
  await browser.storage.sync.set({ [SETTINGS_KEY]: merged });
  return merged;
}

export async function getSiteDimensions(): Promise<SiteDimensions> {
  const result = await browser.storage.local.get(SITE_DIMENSIONS_KEY);
  return (result[SITE_DIMENSIONS_KEY] as SiteDimensions) ?? {};
}

export async function getSiteOverrides(): Promise<SiteOverrides> {
  const result = await browser.storage.local.get(PER_SITE_OVERRIDES_KEY);
  return (result[PER_SITE_OVERRIDES_KEY] as SiteOverrides) ?? {};
}

export async function getSitePicks(): Promise<SitePicks> {
  const result = await browser.storage.local.get(SITE_PICKS_KEY);
  return (result[SITE_PICKS_KEY] as SitePicks) ?? {};
}

/** `www.` is noise -- vlr.gg and www.vlr.gg are the same site to a user. */
export function getSiteKey(hostname: string): string {
  return hostname.replace(/^www\./, '').toLowerCase();
}

export interface SiteActivation {
  active: boolean;
}

/** Resize is off everywhere until the user turns it on for that host. */
export function resolveSiteActivation(hostname: string, overrides: SiteOverrides): SiteActivation {
  return { active: overrides[getSiteKey(hostname)] === true };
}

export interface SiteState {
  settings: ExtensionSettings;
  persistedDimensions: StoredDimensions | null;
  activation: SiteActivation;
  /** The manually chosen target, if the user set one here. */
  pick: StoredPick | null;
}

export async function loadSettingsForSite(hostname: string): Promise<SiteState> {
  const siteKey = getSiteKey(hostname);
  const [settings, allDimensions, overrides, picks] = await Promise.all([
    getSettings(),
    getSiteDimensions(),
    getSiteOverrides(),
    getSitePicks(),
  ]);

  return {
    settings,
    persistedDimensions: allDimensions[siteKey] ?? null,
    activation: resolveSiteActivation(hostname, overrides),
    pick: picks[siteKey] ?? null,
  };
}

export async function persistDimensions(
  hostname: string,
  dimensions: StoredDimensions,
): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSiteDimensions();
  all[siteKey] = dimensions;
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: all });
}

export async function clearDimensions(hostname: string): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSiteDimensions();
  if (!(siteKey in all)) return;
  delete all[siteKey];
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: all });
}

export async function persistPick(hostname: string, pick: StoredPick): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSitePicks();
  all[siteKey] = pick;
  await browser.storage.local.set({ [SITE_PICKS_KEY]: all });
}

/** Back to automatic detection on this site. */
export async function clearSitePick(hostname: string): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSitePicks();
  if (!(siteKey in all)) return;
  delete all[siteKey];
  await browser.storage.local.set({ [SITE_PICKS_KEY]: all });
}

/** Off is the default for every site, so only an explicit "on" needs storing. */
export async function setSiteEnabled(hostname: string, enabled: boolean): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSiteOverrides();

  if (enabled) all[siteKey] = true;
  else delete all[siteKey];

  await browser.storage.local.set({ [PER_SITE_OVERRIDES_KEY]: all });
}

export async function resetAllDimensions(): Promise<void> {
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: {} });
}

/** Subscribe to one storage key. Returns an unsubscribe function. */
export function watchStorage<T>(
  area: 'sync' | 'local',
  key: string,
  callback: (newValue: T | undefined) => void,
): () => void {
  const handler = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    if (key in changes) callback(changes[key].newValue as T | undefined);
  };
  browser.storage[area].onChanged.addListener(handler);
  return () => browser.storage[area].onChanged.removeListener(handler);
}
