import { describe, expect, it, vi } from "vitest";
import { createSettingsAutosave } from "./settings-autosave";

describe("settings autosave", () => {
  it("waits for an earlier write before applying a newer edit", async () => {
    let release!: () => void;
    const firstWrite = new Promise<void>((resolve) => { release = resolve; });
    const write = vi.fn().mockReturnValueOnce(firstWrite).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(write);
    const first = saver.save({ targetLanguage: "ja" });
    const second = saver.save({ targetLanguage: "en", hoverPause: false });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(write.mock.calls).toEqual([[{ targetLanguage: "ja" }], [{ targetLanguage: "en", hoverPause: false }]]);
  });

  it("retries failed changes with later edits, preferring the latest value", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("Storage failed")).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(write);
    await expect(saver.save({ targetLanguage: "ja", hoverPause: false })).rejects.toThrow("Storage failed");
    await saver.save({ targetLanguage: "en" });
    expect(write).toHaveBeenLastCalledWith({ targetLanguage: "en", hoverPause: false });
    await saver.save({});
    expect(write).toHaveBeenLastCalledWith({});
  });

  it("allows an explicit retry without changing a setting", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("Storage failed")).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(write);
    await expect(saver.save({ hoverPause: false })).rejects.toThrow();
    await saver.save({});
    expect(write).toHaveBeenLastCalledWith({ hoverPause: false });
  });

});
