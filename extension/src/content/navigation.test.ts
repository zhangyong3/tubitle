import { describe, expect, it } from "vitest";
import type { CaptionSentence } from "../shared/types";
import { findSentenceIndex, navigationTargetIndex } from "./navigation";

const sentences: CaptionSentence[] = [
  { id: "a", text: "First.", startMs: 1_000, endMs: 2_000 },
  { id: "b", text: "Second.", startMs: 3_000, endMs: 4_000 },
  { id: "c", text: "Third.", startMs: 5_000, endMs: 6_000 }
];

describe("subtitle sequence navigation", () => {
  it("moves exactly one array item while a sentence is active", () => {
    expect(navigationTargetIndex(sentences, 3_500, -1)).toBe(0);
    expect(navigationTargetIndex(sentences, 3_500, 1)).toBe(2);
    expect(navigationTargetIndex(sentences, 3_500, 0)).toBe(1);
  });

  it("uses the neighboring sentence instead of index zero during a caption gap", () => {
    expect(findSentenceIndex(sentences, 4_500)).toBe(-1);
    expect(navigationTargetIndex(sentences, 4_500, -1)).toBe(1);
    expect(navigationTargetIndex(sentences, 4_500, 1)).toBe(2);
  });

  it("clamps only at the actual beginning and end of the sequence", () => {
    expect(navigationTargetIndex(sentences, 500, -1)).toBe(0);
    expect(navigationTargetIndex(sentences, 500, 1)).toBe(0);
    expect(navigationTargetIndex(sentences, 7_000, -1)).toBe(2);
    expect(navigationTargetIndex(sentences, 7_000, 1)).toBe(2);
  });
});
