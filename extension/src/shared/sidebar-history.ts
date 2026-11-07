import type { AnalysisQuery } from "./analysis-stream";
import { normalizeDictionaryWord } from "./dictionary-lookup";
import type { WordNetLookup, WordNetSense } from "./wordnet";

export const SIDEBAR_HISTORY_KEY = "sidebarHistory";
export const DEFAULT_HISTORY_LIMIT = 20;

interface HistoryBase {
  id: string;
  createdAt: number;
}

export interface DictionaryHistoryEntry extends HistoryBase {
  type: "dictionary";
  word: string;
  // Older installations saved MDX excerpts here. They are never exported.
  definitionNote?: string;
  wordNet?: WordNetSense[];
  wordNetLemma?: string;
}

export interface AnalysisHistoryEntry extends HistoryBase {
  type: "analysis";
  requestId: string;
  sentence: string;
  result: string;
  videoId?: string;
  startMs?: number;
}

export interface TranslationHistoryEntry extends HistoryBase {
  type: "translation";
  videoId: string;
  startMs: number;
  sentence: string;
  result: string;
}

export type SidebarHistoryEntry = DictionaryHistoryEntry | AnalysisHistoryEntry | TranslationHistoryEntry;

let writeQueue: Promise<void> = Promise.resolve();

export function parseSidebarHistory(value: unknown): SidebarHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SidebarHistoryEntry => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.createdAt !== "number") return false;
    if (item.type === "dictionary") return typeof item.word === "string" && Boolean(item.word.trim());
    return ((item.type === "analysis" && typeof item.requestId === "string") ||
      (item.type === "translation" && typeof item.videoId === "string" && Number.isFinite(item.startMs))) &&
      typeof item.sentence === "string" &&
      typeof item.result === "string" &&
      Boolean(item.sentence.trim()) &&
      Boolean(item.result.trim());
  }).sort((left, right) => right.createdAt - left.createdAt);
}

export function trimSidebarHistory(entries: SidebarHistoryEntry[], requestedLimit: number): SidebarHistoryEntry[] {
  const limit = Math.min(100, Math.max(1, Math.round(requestedLimit) || DEFAULT_HISTORY_LIMIT));
  let dictionaries = 0;
  let analyses = 0;
  let translations = 0;
  return [...entries].sort((left, right) => right.createdAt - left.createdAt).filter((entry) => {
    if (entry.type === "dictionary") return ++dictionaries <= limit;
    return entry.type === "analysis" ? ++analyses <= limit : ++translations <= limit;
  });
}

export async function getSidebarHistory(): Promise<SidebarHistoryEntry[]> {
  const stored = await chrome.storage.local.get(SIDEBAR_HISTORY_KEY);
  return parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]);
}

export function recordDictionaryHistory(word: string, limit: number): Promise<SidebarHistoryEntry[]> {
  const normalized = normalizeDictionaryWord(word);
  if (!normalized) return getSidebarHistory();
  const entry: DictionaryHistoryEntry = {
    type: "dictionary",
    id: createId("dictionary"),
    word: normalized,
    createdAt: Date.now()
  };
  return writeHistory((current) => {
    const previous = current.find((item): item is DictionaryHistoryEntry =>
      item.type === "dictionary" && normalizeDictionaryWord(item.word) === normalized);
    return [
      { ...entry, wordNet: previous?.wordNet, wordNetLemma: previous?.wordNetLemma },
      ...current.filter((item) => item.type !== "dictionary" || normalizeDictionaryWord(item.word) !== normalized)
    ];
  }, limit);
}

export function recordAnalysisHistory(
  query: AnalysisQuery,
  result: string,
  limit: number
): Promise<SidebarHistoryEntry[]> {
  const entry: AnalysisHistoryEntry = {
    type: "analysis",
    id: createId("analysis"),
    requestId: query.requestId,
    sentence: query.sentence.trim(),
    result: result.trim(),
    videoId: query.videoId,
    startMs: query.startMs,
    createdAt: Date.now()
  };
  if (!entry.sentence || !entry.result) return getSidebarHistory();
  return writeHistory((current) => [
    entry,
    ...current.filter((item) => item.type !== "analysis" || item.requestId !== query.requestId)
  ], limit);
}

export function saveWordNetLookup(word: string, lookup: WordNetLookup, limit: number): Promise<SidebarHistoryEntry[]> {
  return writeHistory((current) => current.map((entry) =>
    entry.type === "dictionary" && normalizeDictionaryWord(entry.word) === word
      ? { ...entry, wordNet: lookup.senses, wordNetLemma: lookup.lemma === word ? undefined : lookup.lemma }
      : entry
  ), limit);
}

export function recordTranslationHistory(
  note: Pick<TranslationHistoryEntry, "videoId" | "startMs" | "sentence" | "result">,
  limit: number
): Promise<SidebarHistoryEntry[]> {
  const entry: TranslationHistoryEntry = { ...note, type: "translation", id: createId("translation"), createdAt: Date.now() };
  return writeHistory((current) => [
    entry,
    ...current.filter((item) => item.type !== "translation" || item.videoId !== note.videoId ||
      item.startMs !== note.startMs || item.sentence !== note.sentence)
  ], limit);
}

export async function clearSidebarHistory(): Promise<void> {
  await enqueueWrite(async () => {
    await chrome.storage.local.remove(SIDEBAR_HISTORY_KEY);
  });
}

function writeHistory(
  update: (current: SidebarHistoryEntry[]) => SidebarHistoryEntry[],
  limit: number
): Promise<SidebarHistoryEntry[]> {
  let next: SidebarHistoryEntry[] = [];
  return enqueueWrite(async () => {
    const current = await getSidebarHistory();
    next = trimSidebarHistory(update(current), limit);
    await chrome.storage.local.set({ [SIDEBAR_HISTORY_KEY]: next });
  }).then(() => next);
}

function enqueueWrite(operation: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => undefined);
  return next;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}
