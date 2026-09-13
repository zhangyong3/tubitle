import { describe, expect, it } from "vitest";
import { audioMimeType } from "./dictionary-audio";

describe("dictionary audio", () => {
  it("detects common MDD audio formats", () => {
    expect(audioMimeType("GB/tell.mp3")).toBe("audio/mpeg");
    expect(audioMimeType("US/tell.wav")).toBe("audio/wav");
    expect(audioMimeType("voice.spx")).toBe("audio/ogg");
  });
});
