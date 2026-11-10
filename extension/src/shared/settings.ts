import type { ExtensionSettings } from "./types";

export const MAX_AUTO_RETURN_SECONDS = 3600;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  settingsVersion: 6,
  enabled: true,
  showChinese: true,
  targetLanguage: "zh",
  excludedLanguages: ["zh"],
  hoverPause: true,
  resumeAfterHover: true,
  autoReturnToSubtitlesSeconds: 10,
  provider: "microsoft",
  microsoftTranslatorKey: "",
  microsoftTranslatorRegion: "",
  microsoftTranslatorEndpoint: "https://api.cognitive.microsofttranslator.com",
  googleTranslateApiKey: "",
  tencentSecretId: "",
  tencentSecretKey: "",
  tencentRegion: "ap-guangzhou",
  tencentConcurrency: 3,
  llmBaseUrl: "https://api.openai.com/v1",
  llmApiKey: "",
  llmModel: "gpt-4.1-mini",
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

export function normalizeAutoReturnSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_AUTO_RETURN_SECONDS, Math.max(0, Math.round(value)))
    : DEFAULT_SETTINGS.autoReturnToSubtitlesSeconds;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as (Partial<ExtensionSettings> & Record<string, unknown>) | undefined;
  const saved = raw ? { ...raw } : undefined;
  if (saved) {
    delete saved.accessToken;
    delete saved.refreshToken;
    delete saved.installationId;
    delete saved.accountEmail;
    delete saved.serverBaseUrl;
    delete saved.serverAccessToken;
  }
  const legacyAppearance = { ...DEFAULT_SETTINGS.subtitleAppearance, ...saved?.subtitleAppearance };
  if (saved && (saved.settingsVersion ?? 0) < 1) {
    if (saved.subtitleAppearance?.englishFontSize === 28) legacyAppearance.englishFontSize = 19;
    if (saved.subtitleAppearance?.chineseFontSize === 22) legacyAppearance.chineseFontSize = 20;
  }
  const settings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    autoReturnToSubtitlesSeconds: normalizeAutoReturnSeconds(saved?.autoReturnToSubtitlesSeconds),
    offlineDictionary: { ...DEFAULT_SETTINGS.offlineDictionary, ...saved?.offlineDictionary },
    offlineDictionaryCss: { ...DEFAULT_SETTINGS.offlineDictionaryCss, ...saved?.offlineDictionaryCss },
    offlineDictionaryResources: { ...DEFAULT_SETTINGS.offlineDictionaryResources, ...saved?.offlineDictionaryResources },
    offlineDictionaryDirectory: { ...DEFAULT_SETTINGS.offlineDictionaryDirectory, ...saved?.offlineDictionaryDirectory },
    subtitlePosition: { ...DEFAULT_SETTINGS.subtitlePosition, ...saved?.subtitlePosition },
    subtitleAppearance: legacyAppearance,
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...saved?.shortcuts }
  };
  settings.tencentConcurrency = Math.min(5, Math.max(1, Math.round(settings.tencentConcurrency) || 3));
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
    autoReturnToSubtitlesSeconds: normalizeAutoReturnSeconds(patch.autoReturnToSubtitlesSeconds ?? current.autoReturnToSubtitlesSeconds),
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
