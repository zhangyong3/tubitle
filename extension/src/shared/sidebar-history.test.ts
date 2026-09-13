import { describe, expect, it } from "vitest";
import { parseSidebarHistory, trimSidebarHistory, type SidebarHistoryEntry } from "./sidebar-history";

describe("sidebar history", () => {
  it("keeps the configured number for each history type", () => {
    const entries: SidebarHistoryEntry[] = [
      { id: "d3", type: "dictionary", word: "three", createdAt: 6 },
      { id: "a3", type: "analysis", requestId: "r3", sentence: "Three.", result: "result", createdAt: 5 },
      { id: "d2", type: "dictionary", word: "two", createdAt: 4 },
      { id: "a2", type: "analysis", requestId: "r2", sentence: "Two.", result: "result", createdAt: 3 },
      { id: "d1", type: "dictionary", word: "one", createdAt: 2 },
      { id: "a1", type: "analysis", requestId: "r1", sentence: "One.", result: "result", createdAt: 1 }
    ];
    expect(trimSidebarHistory(entries, 2).map((entry) => entry.id)).toEqual(["d3", "a3", "d2", "a2"]);
  });

  it("rejects incomplete saved analyses", () => {
    expect(parseSidebarHistory([
      { id: "bad", type: "analysis", requestId: "r", sentence: "Sentence", result: "", createdAt: 2 },
      { id: "good", type: "dictionary", word: "word", createdAt: 1 }
    ]).map((entry) => entry.id)).toEqual(["good"]);
  });
});
