import { DEFAULT_SETTINGS, DEFAULT_OFF_HOSTS, STORAGE_KEYS } from './constants';

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

const {
  SETTINGS: SETTINGS_KEY,
  SITE_DIMENSIONS: SITE_DIMENSIONS_KEY,
  PER_SITE_OVERRIDES: PER_SITE_OVERRIDES_KEY,
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

/** `www.` is noise -- vlr.gg and www.vlr.gg are the same site to a user. */
export function getSiteKey(hostname: string): string {
  return hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * Subdomain-aware: `youtube.com` in the list also covers `m.youtube.com`, but
 * never `notyoutube.com`.
 */
export function isDefaultOffHost(hostname: string): boolean {
  const host = getSiteKey(hostname);
  return DEFAULT_OFF_HOSTS.some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  );
}

export interface SiteActivation {
  active: boolean;
  /** True when the state came from `DEFAULT_OFF_HOSTS` rather than from the user. */
  byDefault: boolean;
}

export function resolveSiteActivation(hostname: string, overrides: SiteOverrides): SiteActivation {
  const override = overrides[getSiteKey(hostname)];
  if (typeof override === 'boolean') return { active: override, byDefault: false };
  return { active: !isDefaultOffHost(hostname), byDefault: isDefaultOffHost(hostname) };
}

export interface SiteState {
  settings: ExtensionSettings;
  persistedDimensions: StoredDimensions | null;
  activation: SiteActivation;
}

export async function loadSettingsForSite(hostname: string): Promise<SiteState> {
  const siteKey = getSiteKey(hostname);
  const [settings, allDimensions, overrides] = await Promise.all([
    getSettings(),
    getSiteDimensions(),
    getSiteOverrides(),
  ]);

  return {
    settings,
    persistedDimensions: allDimensions[siteKey] ?? null,
    activation: resolveSiteActivation(hostname, overrides),
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

/**
 * Records an explicit choice. When the choice matches what the default would have
 * been anyway we drop the entry, so a site later added to or removed from
 * `DEFAULT_OFF_HOSTS` starts behaving correctly for people who never cared.
 */
export async function setSiteEnabled(hostname: string, enabled: boolean): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSiteOverrides();

  if (enabled === !isDefaultOffHost(hostname)) delete all[siteKey];
  else all[siteKey] = enabled;

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
