import type { AnalysisQuery } from "./analysis-stream";
import { normalizeDictionaryWord } from "./dictionary-lookup";
import type { WordNetLookup, WordNetSense } from "./wordnet";

export const SIDEBAR_HISTORY_KEY = "sidebarHistory";
export { DEFAULT_HISTORY_RETENTION_DAYS } from "./history-retention";
import { historyCutoff, historyDateKey } from "./history-retention";
import { getSettings } from "./settings";

interface HistoryBase {
  id: string;
  createdAt: number;
  videoId?: string;
  videoTitle?: string;
  startMs?: number;
  context?: string;
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
  return deduplicateHistory(value.filter((entry): entry is SidebarHistoryEntry => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt) || !Number.isFinite(new Date(item.createdAt).getTime())) return false;
    if (item.type === "dictionary") return typeof item.word === "string" && Boolean(item.word.trim());
    return ((item.type === "analysis" && typeof item.requestId === "string") ||
      (item.type === "translation" && typeof item.videoId === "string" && Number.isFinite(item.startMs))) &&
      typeof item.sentence === "string" &&
      typeof item.result === "string" &&
      Boolean(item.sentence.trim()) &&
      Boolean(item.result.trim());
  }));
}

function historyKey(entry: SidebarHistoryEntry): string {
  const text = entry.type === "dictionary" ? (normalizeDictionaryWord(entry.word) || entry.word.trim().toLowerCase()) : entry.sentence.trim().replace(/\s+/g, " ").toLowerCase();
  return `${entry.type}:${text}`;
}
export function deduplicateHistory(entries: SidebarHistoryEntry[]): SidebarHistoryEntry[] {
  const seen = new Set<string>();
  return [...entries].sort((a, b) => b.createdAt - a.createdAt).filter((entry) => {
    const key = historyKey(entry);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function filterRecentHistory(entries: SidebarHistoryEntry[], days: number, now = Date.now()): SidebarHistoryEntry[] {
  const cutoff = historyCutoff(days, now);
  return deduplicateHistory(entries).filter((entry) => Number.isFinite(entry.createdAt) && entry.createdAt >= cutoff).sort((left, right) => right.createdAt - left.createdAt);
}

export function groupHistoryByDate(entries: SidebarHistoryEntry[]): Array<{ date: string; entries: SidebarHistoryEntry[] }> {
  const groups = new Map<string, SidebarHistoryEntry[]>();
  for (const entry of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
    const date = historyDateKey(entry.createdAt);
    const group = groups.get(date) || [];
    group.push(entry); groups.set(date, group);
  }
  return [...groups].map(([date, items]) => ({ date, entries: items }));
}

export async function pruneSidebarHistory(days: number): Promise<void> {
  await enqueueWrite(async () => {
    const stored = await chrome.storage.local.get(SIDEBAR_HISTORY_KEY);
    const current = parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]);
    const next = filterRecentHistory(current, days);
    if (Array.isArray(stored[SIDEBAR_HISTORY_KEY]) && next.length !== stored[SIDEBAR_HISTORY_KEY].length) await chrome.storage.local.set({ [SIDEBAR_HISTORY_KEY]: next });
  });
}

export async function getSidebarHistory(): Promise<SidebarHistoryEntry[]> {
  const stored = await chrome.storage.local.get(SIDEBAR_HISTORY_KEY);
  return filterRecentHistory(parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]), (await getSettings()).historyRetentionDays);
}

export function recordDictionaryHistory(word: string, days: number, source: Pick<HistoryBase, "videoId" | "videoTitle" | "startMs" | "context"> = {}): Promise<SidebarHistoryEntry[]> {
  const normalized = normalizeDictionaryWord(word);
  if (!normalized) return getSidebarHistory();
  const entry: DictionaryHistoryEntry = {
    ...source,
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
  }, days);
}

export function recordAnalysisHistory(
  query: AnalysisQuery,
  result: string,
  days: number
): Promise<SidebarHistoryEntry[]> {
  const entry: AnalysisHistoryEntry = {
    type: "analysis",
    id: createId("analysis"),
    requestId: query.requestId,
    sentence: query.sentence.trim(),
    result: result.trim(),
    videoId: query.videoId,
    videoTitle: query.videoTitle,
    startMs: query.startMs,
    createdAt: Date.now()
  };
  if (!entry.sentence || !entry.result) return getSidebarHistory();
  return writeHistory((current) => [
    entry,
    ...current.filter((item) => item.type !== "analysis" || item.requestId !== query.requestId)
  ], days);
}

export function saveWordNetLookup(word: string, lookup: WordNetLookup, days: number): Promise<SidebarHistoryEntry[]> {
  return writeHistory((current) => current.map((entry) =>
    entry.type === "dictionary" && normalizeDictionaryWord(entry.word) === word
      ? { ...entry, wordNet: lookup.senses, wordNetLemma: lookup.lemma === word ? undefined : lookup.lemma }
      : entry
  ), days);
}

export function recordTranslationHistory(
  note: Pick<TranslationHistoryEntry, "videoId" | "videoTitle" | "startMs" | "sentence" | "result">,
  days: number
): Promise<SidebarHistoryEntry[]> {
  const entry: TranslationHistoryEntry = { ...note, type: "translation", id: createId("translation"), createdAt: Date.now() };
  return writeHistory((current) => [
    entry,
    ...current.filter((item) => item.type !== "translation" || historyDateKey(item.createdAt) !== historyDateKey(entry.createdAt) || item.videoId !== note.videoId ||
      item.startMs !== note.startMs || item.sentence !== note.sentence)
  ], days);
}

export async function deleteSidebarHistory(id: string): Promise<SidebarHistoryEntry[]> {
  return writeHistory((current) => current.filter((entry) => entry.id !== id), (await getSettings()).historyRetentionDays);
}

export async function clearSidebarHistory(): Promise<void> {
  await enqueueWrite(async () => {
    await chrome.storage.local.remove(SIDEBAR_HISTORY_KEY);
  });
}

function writeHistory(
  update: (current: SidebarHistoryEntry[]) => SidebarHistoryEntry[],
  days: number
): Promise<SidebarHistoryEntry[]> {
  let next: SidebarHistoryEntry[] = [];
  return enqueueWrite(async () => {
    const stored = await chrome.storage.local.get(SIDEBAR_HISTORY_KEY);
    const current = parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]);
    next = filterRecentHistory(update(current), days);
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
