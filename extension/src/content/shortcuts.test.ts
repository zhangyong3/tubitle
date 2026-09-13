import { describe, expect, it } from "vitest";
import { shortcutFromEvent, shortcutsMatch } from "./shortcuts";

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides
  } as KeyboardEvent;
}

describe("keyboard shortcuts", () => {
  it.each([
    ["KeyT", "†", "Alt+T"],
    ["KeyA", "å", "Alt+A"],
    ["KeyR", "®", "Alt+R"]
  ])("uses the physical key for macOS Option shortcuts", (code, key, expected) => {
    expect(shortcutFromEvent(keyboardEvent({ code, key, altKey: true }))).toBe(expected);
  });

  it("keeps arrow shortcuts working", () => {
    expect(shortcutFromEvent(keyboardEvent({ code: "ArrowLeft", key: "ArrowLeft", altKey: true }))).toBe("Alt+ArrowLeft");
  });

  it("matches configured shortcuts without case or whitespace sensitivity", () => {
    expect(shortcutsMatch("Alt+R", " alt + r ")).toBe(true);
  });
});
