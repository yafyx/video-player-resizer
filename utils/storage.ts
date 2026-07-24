import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';

export interface ExtensionSettings {
  enabled: boolean;
  lockAspectRatio: boolean;
}

export type SiteDimensions = Record<string, { width: number; height: number }>;

const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;
const SITE_DIMENSIONS_KEY = STORAGE_KEYS.SITE_DIMENSIONS;
const PER_SITE_DISABLED_KEY = STORAGE_KEYS.PER_SITE_DISABLED;

/**
 * Load global extension settings.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.sync.get(SETTINGS_KEY);
  return (result[SETTINGS_KEY] as ExtensionSettings) ?? { ...DEFAULT_SETTINGS };
}

/**
 * Save global extension settings.
 */
export async function setSettings(settings: ExtensionSettings): Promise<void> {
  await browser.storage.sync.set({ [SETTINGS_KEY]: settings });
}

/**
 * Load per-site dimension overrides.
 */
export async function getSiteDimensions(): Promise<SiteDimensions> {
  const result = await browser.storage.local.get(SITE_DIMENSIONS_KEY);
  return (result[SITE_DIMENSIONS_KEY] as SiteDimensions) ?? {};
}

/**
 * Load per-site disabled flags.
 */
export async function getPerSiteDisabled(): Promise<Record<string, boolean>> {
  const result = await browser.storage.local.get(PER_SITE_DISABLED_KEY);
  return (result[PER_SITE_DISABLED_KEY] as Record<string, boolean>) ?? {};
}

/**
 * Derive a stable site key from the URL's hostname.
 */
function getSiteKey(hostname: string): string {
  return hostname.replace(/^www\./, '');
}

/**
 * Convenience: load settings merged with per-site overrides.
 */
export async function loadSettingsForSite(hostname: string): Promise<{
  settings: ExtensionSettings;
  persistedDimensions: { width: number; height: number } | null;
  disabled: boolean;
}> {
  const siteKey = getSiteKey(hostname);
  const [settings, allDimensions, disabledSites] = await Promise.all([
    getSettings(),
    getSiteDimensions(),
    getPerSiteDisabled(),
  ]);

  return {
    settings,
    persistedDimensions: allDimensions[siteKey] ?? null,
    disabled: disabledSites[siteKey] ?? false,
  };
}

/**
 * Save the current dimensions for a specific site.
 */
export async function persistDimensions(
  hostname: string,
  dimensions: { width: number; height: number },
): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSiteDimensions();
  all[siteKey] = dimensions;
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: all });
}

/**
 * Set or clear the per-site disabled flag.
 */
export async function setSiteDisabled(hostname: string, disabled: boolean): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getPerSiteDisabled();
  if (disabled) {
    all[siteKey] = true;
  } else {
    delete all[siteKey];
  }
  await browser.storage.local.set({ [PER_SITE_DISABLED_KEY]: all });
}

/**
 * Listen for storage changes (replaces WXT storage.watch).
 * Calls `callback` with the new value when the given key changes.
 */
export function watchStorage<T>(
  area: 'sync' | 'local',
  key: string,
  callback: (newValue: T | undefined) => void,
): () => void {
  const handler = (changes: { [name: string]: browser.storage.StorageChange }) => {
    if (changes[key]) {
      callback(changes[key].newValue as T | undefined);
    }
  };
  browser.storage[area].onChanged.addListener(handler);
  return () => browser.storage[area].onChanged.removeListener(handler);
}

/**
 * Reset all stored dimensions.
 */
export async function resetAllDimensions(): Promise<void> {
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: {} });
}