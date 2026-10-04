import { describe, expect, it } from "vitest";
import { providerLanguage, shouldSkipTranslation, sourceLanguage } from "./languages";
import { DEFAULT_SETTINGS } from "./settings";

describe("translation language policy", () => {
  it("skips Chinese transcripts even when the track is missing or labelled English", () => {
    for (const track of ["", "en"]) {
      expect(shouldSkipTranslation(sourceLanguage("这个视频介绍如何学习英语。", track), DEFAULT_SETTINGS)).toBe(true);
    }
  });
  it("matches regional variants and multiple excluded languages", () => {
    const settings = { targetLanguage: "fr", excludedLanguages: ["zh", "ja"] };
    for (const language of ["zh-Hant", "zh-CN", "ja-JP", "fr-CA"]) expect(shouldSkipTranslation(language, settings)).toBe(true);
    expect(shouldSkipTranslation("en-US", settings)).toBe(false);
  });
  it("allows Chinese to be translated when targeting English without exclusions", () => {
    expect(shouldSkipTranslation("zh", { targetLanguage: "en", excludedLanguages: [] })).toBe(false);
  });
  it("does not confuse Japanese or Korean with Chinese", () => {
    expect(sourceLanguage("今日は日本語を勉強します", "")).toBe("ja");
    expect(sourceLanguage("한국어 자막", "")).toBe("ko");
    expect(sourceLanguage("This is an English sentence.", "en-US")).toBe("en-US");
  });
  it("maps Chinese variants to each provider", () => {
    expect(providerLanguage("zh", "microsoft")).toBe("zh-Hans");
    expect(providerLanguage("zh-TW", "google")).toBe("zh-TW");
    expect(providerLanguage("zh-Hant", "tencent")).toBe("zh-TW");
  });
});
