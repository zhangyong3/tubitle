export const DEFAULT_HISTORY_RETENTION_DAYS = 30;
export const MAX_HISTORY_RETENTION_DAYS = 365;
export function normalizeHistoryDays(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_HISTORY_RETENTION_DAYS, Math.max(1, Math.round(value)))
    : DEFAULT_HISTORY_RETENTION_DAYS;
}
export function historyCutoff(days: number, now = Date.now()): number {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - normalizeHistoryDays(days) + 1);
  return cutoff.getTime();
}
export function historyDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
