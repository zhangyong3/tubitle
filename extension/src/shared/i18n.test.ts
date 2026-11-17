import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "./locales/catalogs";
import { getUiLanguage, resolveUiLanguage, setUiLanguage, subscribeUiLanguage, t, UI_LANGUAGES } from "./i18n";

beforeEach(() => setUiLanguage("en"));
afterEach(() => vi.unstubAllGlobals());

describe("interface language catalogs", () => {
  for (const [language] of UI_LANGUAGES) {
    it(`${language} covers every message and preserves interpolation placeholders`, () => {
      const catalog = catalogs[language]!;
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(catalogs.en!).sort());
      for (const [source, translation] of Object.entries(catalog)) {
        expect(translation.trim(), `${language}: ${source}`).not.toBe("");
        expect(translation.match(/\{\d+\}/g)?.sort() || [], `${language}: ${source}`)
          .toEqual(source.match(/\{\d+\}/g)?.sort() || []);
      }
      setUiLanguage(language);
      expect(t("常规")).toBe(catalog["常规"]);
      expect(t("记录数：{0}", 12)).toBe(catalog["记录数：{0}"]!.replace("{0}", "12"));
    });
  }


});

describe("language selection", () => {
  it.each([
    ["zh-Hant", "zh-TW"], ["zh_HK", "zh-TW"], ["zh-SG", "zh-CN"],
    ["pt-BR", "pt"], ["fr-CA", "fr"], ["ar-EG", "ar"], ["xx", "en"], [undefined, "en"]
  ])("resolves %s to %s", (value, expected) => expect(resolveUiLanguage(value)).toBe(expected));

  it("notifies open interfaces immediately and supports unsubscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = subscribeUiLanguage(first);
    const stopSecond = subscribeUiLanguage(second);
    setUiLanguage("ja");
    expect(getUiLanguage()).toBe("ja");
    expect(t("设置")).toBe("設定");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    unsubscribe();
    setUiLanguage("ko");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it("localizes persisted status templates while preserving user-provided text", () => {
    setUiLanguage("de");
    expect(t("01:23 的译文已加入 PDF 旁批")).toBe("Übersetzung bei 01:23 zu PDF-Notizen hinzugefügt");
    expect(t("删除记录：{0}", "Original <video> {1}")).toBe("Eintrag löschen: Original <video> {1}");
    expect(t("This is the actual subtitle.")).toBe("This is the actual subtitle.");
    expect(t("自定义的词典内容")).toBe("自定义的词典内容");
    setUiLanguage("zh-CN");
    expect(t("01:23 的译文已加入 PDF 旁批")).toBe("01:23 的译文已加入 PDF 旁批");
  });

  it("restores saved language, applies RTL and reacts to storage changes", async () => {
    vi.resetModules();
    const listeners: Array<(changes: Record<string, { newValue: unknown }>, area: string) => void> = [];
    vi.stubGlobal("document", { documentElement: {}, body: { dataset: { title: "Tubitle 设置" } }, title: "" });
    vi.stubGlobal("chrome", { storage: {
      local: { get: vi.fn().mockResolvedValue({ settings: { uiLanguage: "ar" } }) },
      onChanged: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) }
    } });
    const i18n = await import("./i18n");
    i18n.initializeI18n(true);
    await Promise.resolve();
    expect(document.documentElement).toMatchObject({ lang: "ar", dir: "rtl" });
    expect(document.title).toBe("إعدادات Tubitle");
    listeners[0]!({ settings: { newValue: { uiLanguage: "fr" } } }, "local");
    expect(document.documentElement).toMatchObject({ lang: "fr", dir: "ltr" });
    expect(i18n.t("设置")).toBe("Paramètres");
  });
});
