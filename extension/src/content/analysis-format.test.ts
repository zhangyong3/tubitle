import { describe, expect, it } from "vitest";
import { formatAnalysisForNotes } from "./analysis-format";

describe("formatAnalysisForNotes", () => {
  it("formats a complete analysis as plain-text notes", () => {
    const note = formatAnalysisForNotes({
      original: "The plan proved viable.",
      translation: "该计划被证明是可行的。",
      structure: ["The plan 是主语，proved 是系动词，viable 是表语。"],
      vocabulary: [{ word: "viable", level: "B2", meaning: "可行的", example: "The proposal is viable." }],
      phrases: [{ phrase: "prove viable", meaning: "证明可行", example: "The method proved viable." }]
    });
    expect(note).toContain("原句：The plan proved viable.");
    expect(note).toContain("viable [B2]：可行的");
    expect(note).toContain("例句：The method proved viable.");
  });
});
