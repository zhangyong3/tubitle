import { expect, it } from "vitest";
import { buildTranscriptNotes } from "./transcript-notes";
import type { SidebarHistoryEntry } from "./sidebar-history";
import type { TranscriptPanelSnapshot } from "./types";

const snapshot: TranscriptPanelSnapshot = {
  videoId: "current", videoTitle: "Study notes", activeIndex: 0,
  currentTimeMs: 0, durationMs: 6000, loading: false,
  sentences: [
    { id: "1", startMs: 0, endMs: 2000, text: "Keep the cats indoors.", translation: "把猫留在室内。" },
    { id: "2", startMs: 2000, endMs: 4000, text: "The CAT is out.", translation: "预取的译文" },
    { id: "3", startMs: 4000, endMs: 6000, text: "The CAT is out." },
    { id: "4", startMs: 6000, endMs: 7000, text: "Close the door.", translationError: "翻译失败" }
  ]
};

it("exports existing translations including prefetch and manual study, leaving failed lines blank", () => {
  const history: SidebarHistoryEntry[] = [
    { type: "translation", id: "t", createdAt: 3, videoId: "current", startMs: 4000, sentence: "The CAT is out.", result: "猫出去了。" },
    { type: "analysis", id: "foreign", requestId: "f", createdAt: 2, videoId: "different", sentence: "Keep the cats indoors.", result: "翻译：在其他视频查过" },
    { type: "dictionary", id: "d", createdAt: 1, word: "cat",
      wordNet: [{ partOfSpeech: "noun", definitions: ["a small domesticated feline"], examples: [] }] }
  ];
  const rows = buildTranscriptNotes(snapshot, history);
  expect(rows.map(({ text }) => text)).toEqual(snapshot.sentences.map(({ text }) => text));
  expect(rows.map(({ translation }) => translation)).toEqual(["把猫留在室内。", "预取的译文", "猫出去了。", undefined]);
  expect(rows.map(({ highlights }) => highlights.length)).toEqual([0, 1, 1, 0]);
  expect(rows[1]?.words).toEqual([{ word: "cat", senses: history[2]?.type === "dictionary" && history[2].wordNet }]);
});

it("keeps a legacy AI note on the source passage after it was split into shorter rows", () => {
  const rows = buildTranscriptNotes(snapshot, [{
    type: "analysis", id: "a", requestId: "a", createdAt: 1,
    sentence: "Keep the cats indoors. The CAT is out.",
    result: "**翻译：** 把猫留在室内。猫出去了。\n**结构：** 第一句是祈使句。"
  }, { type: "translation", id: "t", createdAt: 2, videoId: "current", startMs: 0,
    sentence: "Keep the cats indoors.", result: "手动保存的译文" }]);
  expect(rows[0]?.translation).toBe("把猫留在室内。猫出去了。");
  expect(rows[0]?.explanation).toBe("解析对应第 1 至 2 段\n结构： 第一句是祈使句。");
  expect(rows[1]?.translation).toBeUndefined();
});

it("does not add an online translation when a saved analysis omits its translation section", () => {
  const [row] = buildTranscriptNotes(snapshot, [{
    type: "analysis", id: "a", requestId: "a", createdAt: 1, videoId: "current",
    sentence: "Keep the cats indoors.", result: "结构：这是一个祈使句。"
  }]);
  expect(row?.translation).toBeUndefined();
  expect(row?.explanation).toBe("结构：这是一个祈使句。");
});

it("ignores cached MDX excerpts and exports WordNet senses and examples for whole phrases", () => {
  const legacy = { type: "dictionary", id: "old", createdAt: 1, word: "cat", definitionNote: "BrE NAmE 小猫" } as const;
  const oldRow = buildTranscriptNotes(snapshot, [legacy])[1]!;
  expect(oldRow.highlights).toHaveLength(1);
  expect(oldRow.words).toEqual([]);

  const phrase: SidebarHistoryEntry = { ...legacy, id: "phrase", word: "vantage point",
    wordNet: [{ partOfSpeech: "noun", definitions: ["a place to observe from"], examples: ["from that vantage point"] }] };
  const [matched, missed] = buildTranscriptNotes({ ...snapshot, sentences: [
    { id: "p", startMs: 0, endMs: 2000, text: "From this vantage point." },
    { id: "q", startMs: 2000, endMs: 4000, text: "A vantage, point it out." }
  ] }, [phrase]);
  expect(matched?.highlights).toEqual([{ start: 10, end: 23 }]);
  expect(matched?.words).toEqual([{ word: "vantage point", senses: phrase.wordNet }]);
  expect(missed?.words).toEqual([]);
});
