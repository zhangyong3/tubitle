import type { ExtensionSettings, TranslationProvider } from "./types";

export const LANGUAGES = [
  ["zh", "中文（简体）"], ["zh-TW", "中文（繁体）"], ["en", "英语"],
  ["ja", "日语"], ["ko", "韩语"], ["fr", "法语"], ["de", "德语"],
  ["es", "西班牙语"], ["pt", "葡萄牙语"], ["ru", "俄语"],
  ["it", "意大利语"], ["ar", "阿拉伯语"], ["th", "泰语"], ["vi", "越南语"]
] as const;

export function languageFamily(language: string): string {
  return language.toLowerCase().split("-")[0]!;
}

// Script detection also protects transcript fallbacks and incorrectly labelled tracks.
export function sourceLanguage(text: string, trackLanguage = ""): string {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  const letters = text.match(/\p{L}/gu) ?? [];
  const han = text.match(/\p{Script=Han}/gu) ?? [];
  if (han.length > 0 && han.length / letters.length > 0.5) return "zh";
  return trackLanguage;
}

export function shouldSkipTranslation(language: string, settings: Pick<ExtensionSettings, "targetLanguage" | "excludedLanguages">): boolean {
  if (!language) return false;
  const family = languageFamily(language);
  return family === languageFamily(settings.targetLanguage) || settings.excludedLanguages.some((item) => languageFamily(item) === family);
}

export function providerLanguage(language: string, provider: TranslationProvider): string {
  if (languageFamily(language) !== "zh") return languageFamily(language);
  const traditional = /(?:tw|hant|hk)/i.test(language);
  if (provider === "microsoft") return traditional ? "zh-Hant" : "zh-Hans";
  if (provider === "google") return traditional ? "zh-TW" : "zh-CN";
  return traditional ? "zh-TW" : "zh";
}
