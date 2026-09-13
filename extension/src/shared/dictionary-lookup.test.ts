import { describe, expect, it } from "vitest";
import { normalizeDictionaryWord, selectDictionaryCandidates } from "./dictionary-lookup";

describe("offline dictionary lookup", () => {
  it("normalizes subtitle punctuation without losing apostrophes", () => {
    expect(normalizeDictionaryWord("‘Couldn't,’")).toBe("couldn't");
  });

  it("only selects an exact entry while preserving suggestions", () => {
    const result = selectDictionaryCandidates("book", [
      { word: "book", offset: 1 },
      { word: "bookcase", offset: 2 }
    ]);
    expect(result.exact?.offset).toBe(1);
    expect(result.suggestions).toEqual(["book", "bookcase"]);
  });

  it("does not display the next alphabetical entry as a definition", () => {
    const result = selectDictionaryCandidates("booj", [{ word: "book", offset: 1 }]);
    expect(result.exact).toBeUndefined();
  });
});
