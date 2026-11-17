import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "./settings";

afterEach(() => vi.unstubAllGlobals());

describe("persisted interface language", () => {
  it("migrates existing settings without changing subtitle language or API keys", async () => {
    const saved = { ...DEFAULT_SETTINGS, settingsVersion: 9, targetLanguage: "de", llmApiKey: "local-key" };
    delete (saved as Partial<typeof saved>).uiLanguage;
    const set = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ settings: saved }), set } } });
    const migrated = await getSettings();
    expect(migrated).toMatchObject({ uiLanguage: DEFAULT_SETTINGS.uiLanguage, targetLanguage: "de", llmApiKey: "local-key", settingsVersion: 10 });
    expect(set).toHaveBeenCalledOnce();
  });

  it("saves interface language independently and restores it after reopening", async () => {
    let settings = { ...DEFAULT_SETTINGS, targetLanguage: "fr" };
    vi.stubGlobal("chrome", { storage: { local: {
      get: async () => ({ settings }),
      set: async (value: { settings: typeof settings }) => { settings = value.settings; }
    } } });
    await updateSettings({ uiLanguage: "ja" });
    expect(await getSettings()).toMatchObject({ uiLanguage: "ja", targetLanguage: "fr" });
  });
});
