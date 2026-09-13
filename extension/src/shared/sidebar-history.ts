import type { AnalysisQuery } from "./analysis-stream";

export const SIDEBAR_HISTORY_KEY = "sidebarHistory";
export const DEFAULT_HISTORY_LIMIT = 20;

interface HistoryBase {
  id: string;
  createdAt: number;
}

export interface DictionaryHistoryEntry extends HistoryBase {
  type: "dictionary";
  word: string;
}

export interface AnalysisHistoryEntry extends HistoryBase {
  type: "analysis";
  requestId: string;
  sentence: string;
  result: string;
}

export type SidebarHistoryEntry = DictionaryHistoryEntry | AnalysisHistoryEntry;

let writeQueue: Promise<void> = Promise.resolve();

export function parseSidebarHistory(value: unknown): SidebarHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SidebarHistoryEntry => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.createdAt !== "number") return false;
    if (item.type === "dictionary") return typeof item.word === "string" && Boolean(item.word.trim());
    return item.type === "analysis" &&
      typeof item.requestId === "string" &&
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
  return [...entries].sort((left, right) => right.createdAt - left.createdAt).filter((entry) => {
    if (entry.type === "dictionary") return ++dictionaries <= limit;
    return ++analyses <= limit;
  });
}

export async function getSidebarHistory(): Promise<SidebarHistoryEntry[]> {
  const stored = await chrome.storage.local.get(SIDEBAR_HISTORY_KEY);
  return parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]);
}

export function recordDictionaryHistory(word: string, limit: number): Promise<SidebarHistoryEntry[]> {
  const normalized = word.trim();
  if (!normalized) return getSidebarHistory();
  const entry: DictionaryHistoryEntry = {
    type: "dictionary",
    id: createId("dictionary"),
    word: normalized,
    createdAt: Date.now()
  };
  return writeHistory((current) => [
    entry,
    ...current.filter((item) => item.type !== "dictionary" || item.word.toLocaleLowerCase() !== normalized.toLocaleLowerCase())
  ], limit);
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
    createdAt: Date.now()
  };
  if (!entry.sentence || !entry.result) return getSidebarHistory();
  return writeHistory((current) => [
    entry,
    ...current.filter((item) => item.type !== "analysis" || item.requestId !== query.requestId)
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
