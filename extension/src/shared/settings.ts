import type { ExtensionSettings } from "./types";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  settingsVersion: 4,
  enabled: true,
  showChinese: true,
  hoverPause: true,
  resumeAfterHover: true,
  provider: "microsoft",
  serverBaseUrl: "http://localhost:3000",
  serverAccessToken: "",
  historyLimit: 20,
  offlineDictionary: { configured: false, name: "", size: 0, lastModified: 0 },
  offlineDictionaryCss: { configured: false, name: "", size: 0, lastModified: 0 },
  offlineDictionaryResources: { configured: false, files: [] },
  offlineDictionaryDirectory: { name: "", lastImported: 0 },
  subtitlePosition: { xPercent: 50, yPercent: 74 },
  subtitleAppearance: {
    englishFontSize: 19,
    chineseFontSize: 20,
    englishColor: "#ffffff",
    chineseColor: "#ffe58f"
  },
  shortcuts: {
    previous: "Alt+ArrowLeft",
    next: "Alt+ArrowRight",
    repeat: "Alt+R",
    toggleTranslation: "Alt+T",
    analyze: "Alt+A"
  }
};

const STORAGE_KEY = "settings";

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as (Partial<ExtensionSettings> & Record<string, unknown>) | undefined;
  const saved = raw ? { ...raw } : undefined;
  if (saved) {
    delete saved.accessToken;
    delete saved.refreshToken;
    delete saved.installationId;
    delete saved.accountEmail;
  }
  const legacyAppearance = { ...DEFAULT_SETTINGS.subtitleAppearance, ...saved?.subtitleAppearance };
  if (saved && (saved.settingsVersion ?? 0) < 1) {
    if (saved.subtitleAppearance?.englishFontSize === 28) legacyAppearance.englishFontSize = 19;
    if (saved.subtitleAppearance?.chineseFontSize === 22) legacyAppearance.chineseFontSize = 20;
  }
  const settings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    offlineDictionary: { ...DEFAULT_SETTINGS.offlineDictionary, ...saved?.offlineDictionary },
    offlineDictionaryCss: { ...DEFAULT_SETTINGS.offlineDictionaryCss, ...saved?.offlineDictionaryCss },
    offlineDictionaryResources: { ...DEFAULT_SETTINGS.offlineDictionaryResources, ...saved?.offlineDictionaryResources },
    offlineDictionaryDirectory: { ...DEFAULT_SETTINGS.offlineDictionaryDirectory, ...saved?.offlineDictionaryDirectory },
    subtitlePosition: { ...DEFAULT_SETTINGS.subtitlePosition, ...saved?.subtitlePosition },
    subtitleAppearance: legacyAppearance,
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...saved?.shortcuts }
  };
  if (raw && ((raw.settingsVersion as number | undefined) ?? 0) < DEFAULT_SETTINGS.settingsVersion) {
    settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }
  return settings;
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    offlineDictionary: { ...current.offlineDictionary, ...patch.offlineDictionary },
    offlineDictionaryCss: { ...current.offlineDictionaryCss, ...patch.offlineDictionaryCss },
    offlineDictionaryResources: { ...current.offlineDictionaryResources, ...patch.offlineDictionaryResources },
    offlineDictionaryDirectory: { ...current.offlineDictionaryDirectory, ...patch.offlineDictionaryDirectory },
    subtitlePosition: { ...current.subtitlePosition, ...patch.subtitlePosition },
    subtitleAppearance: { ...current.subtitleAppearance, ...patch.subtitleAppearance },
    shortcuts: { ...current.shortcuts, ...patch.shortcuts }
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
