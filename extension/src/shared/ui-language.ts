export const UI_LANGUAGES = [
  ["en", "English"], ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"],
  ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"],
  ["es", "Español"], ["pt", "Português"], ["ru", "Русский"], ["it", "Italiano"],
  ["ar", "العربية"], ["th", "ไทย"], ["vi", "Tiếng Việt"]
] as const;
export type UiLanguage = typeof UI_LANGUAGES[number][0];
export function resolveUiLanguage(value?: string): UiLanguage {
  const normalized = typeof value === "string" ? value.replace(/_/g, "-").toLowerCase() : "en";
  if (normalized.startsWith("zh")) return /(?:tw|hk|mo|hant)/.test(normalized) ? "zh-TW" : "zh-CN";
  return UI_LANGUAGES.find(([code]) => code === normalized.split("-")[0])?.[0] || "en";
}
