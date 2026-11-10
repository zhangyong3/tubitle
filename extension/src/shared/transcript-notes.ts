import { normalizeDictionaryWord } from "./dictionary-lookup";
import type { DictionaryHistoryEntry, SidebarHistoryEntry } from "./sidebar-history";
import type { TranscriptPanelSnapshot } from "./types";
import type { WordNetSense } from "./wordnet";

export interface TranscriptNoteRow {
  startMs: number;
  text: string;
  highlights: Array<{ start: number; end: number }>;
  words: Array<{ word: string; senses: WordNetSense[] }>;
  translation?: string;
  explanation?: string;
}

export function captionWords(text: string) {
  return text.matchAll(/\p{L}+(?:['’-]\p{L}+)*/gu);
}
const normalizeSentence = (text: string) => text.trim().replace(/\s+/g, " ").replace(/[‘’]/g, "'").toLowerCase();

function parseAnalysis(result: string): { translation?: string; explanation?: string } {
  const translation: string[] = [];
  const explanation: string[] = [];
  let inTranslation = false;
  for (const raw of result.split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
    const heading = /^(原句|翻译|结构|词汇|短语)\s*[：:]\s*(.*)$/.exec(line);
    if (heading) inTranslation = heading[1] === "翻译";
    if (heading?.[1] === "原句") continue;
    if (inTranslation) translation.push(heading ? heading[2]! : line);
    else if (line) explanation.push(line);
  }
  return { translation: translation.join(" ").trim() || undefined, explanation: explanation.join("\n") || undefined };
}

export function buildTranscriptNotes(snapshot: TranscriptPanelSnapshot, history: SidebarHistoryEntry[]): TranscriptNoteRow[] {
  const dictionary = new Map<string, DictionaryHistoryEntry>();
  let maxWords = 1;
  for (const entry of history) {
    if (entry.type !== "dictionary") continue;
    const key = normalizeDictionaryWord(entry.word);
    if (!key || dictionary.has(key)) continue;
    dictionary.set(key, entry);
    maxWords = Math.max(maxWords, key.split(" ").length);
  }

  const rows = snapshot.sentences.map((sentence): TranscriptNoteRow => {
    const highlights: TranscriptNoteRow["highlights"] = [];
    const words = new Map<string, TranscriptNoteRow["words"][number]>();
    const tokens = [...captionWords(sentence.text)];
    for (let i = 0; i < tokens.length; i++) {
      const start = tokens[i]!.index;
      for (let j = i; j < Math.min(tokens.length, i + maxWords); j++) {
        if (j > i && !/^\s+$/.test(sentence.text.slice(tokens[j - 1]!.index + tokens[j - 1]![0].length, tokens[j]!.index))) break;
        const end = tokens[j]!.index + tokens[j]![0].length;
        const key = normalizeDictionaryWord(sentence.text.slice(start, end));
        const entry = dictionary.get(key);
        if (!entry) continue;
        const previous = highlights.at(-1);
        if (previous && previous.end >= start) previous.end = Math.max(previous.end, end);
        else highlights.push({ start, end });
        if (entry.wordNet?.length && !words.has(key)) {
          words.set(key, { word: entry.word, senses: entry.wordNet });
        }
      }
    }
    return { startMs: sentence.startMs, text: sentence.text, highlights, words: [...words.values()] };
  });

  const originals = rows.map((row) => normalizeSentence(row.text));
  const exact = new Map<string, number[]>();
  originals.forEach((original, index) => {
    const matches = exact.get(original);
    if (matches) matches.push(index);
    else exact.set(original, [index]);
  });
  const analysed = new Set<number>();
  const analysisCoverage = new Set<number>();
  const savedTranslations = new Map<number, string>();
  for (const entry of history) {
    if (entry.type === "dictionary" || (entry.videoId && entry.videoId !== snapshot.videoId)) continue;
    const original = normalizeSentence(entry.sentence);
    let matches = (exact.get(original) ?? []).map((index) => ({ start: index, end: index }));
    if (!matches.length) {
      // Older explanations can span rows after the caption segmentation changes.
      matches = originals.flatMap((text, index) => {
        if (!original.startsWith(text + " ")) return [];
        let joined = text;
        for (let end = index + 1; end < originals.length; end++) {
          joined += " " + originals[end];
          if (joined === original) return [{ start: index, end }];
          if (!original.startsWith(joined + " ")) break;
        }
        return [];
      });
    }
    const time = entry.startMs;
    const match = (typeof time === "number" && matches.find(({ start }) => Math.abs(rows[start]!.startMs - time) < 20)) ||
      (matches.length === 1 ? matches[0] : undefined);
    if (!match) continue;
    const row = rows[match.start]!;
    if (entry.type === "translation") {
      if (!savedTranslations.has(match.start)) savedTranslations.set(match.start, entry.result);
    } else if (!analysed.has(match.start)) {
      analysed.add(match.start);
      for (let index = match.start; index <= match.end; index++) analysisCoverage.add(index);
      const analysis = parseAnalysis(entry.result);
      row.translation = analysis.translation;
      row.explanation = match.start === match.end ? analysis.explanation
        : [`解析对应第 ${match.start + 1} 至 ${match.end + 1} 段`, analysis.explanation].filter(Boolean).join("\n");
    }
  }

  rows.forEach((row, index) => {
    if (analysisCoverage.has(index)) return;
    row.translation = snapshot.sentences[index]!.translation?.trim() || savedTranslations.get(index);
  });
  return rows;
}

export function formatCaptionTime(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs < 0) return "00:00";
  const seconds = Math.floor(valueMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${pad(minutes)}:${pad(remainder)}`;
}
