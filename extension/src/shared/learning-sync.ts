export const SYNC_STATE_KEY = 'learningSyncStateV2';
export const SYNC_ALARM = 'learning-sync';
declare const __TUBITLE_SITE_URL__: string | undefined;
// Set by the release build; local development requires no user configuration.
export const TUBITLE_SITE_URL = typeof __TUBITLE_SITE_URL__ === 'string' ? __TUBITLE_SITE_URL__ : 'http://127.0.0.1:3100';
export interface SyncRecord {
  clientRecordId: string;
  kind: 'word' | 'sentence';
  text: string;
  context?: string;
  translation?: string;
  note?: string;
  analysis?: string;
  videoId: string;
  videoTitle?: string;
  startSeconds: number;
}
export interface SyncStatus {
  today?: import("./learning-activity").DailyLearningStats;
  connected: boolean;
  name?: string;
  pending: number;
  lastSyncedAt?: number;
  error?: string;
}

export const DICTIONARY_SNAPSHOT_PREFIX = 'tubitle-dictionaries-v1:';

// Apply again at upload time so queues saved by older versions remain local-only.
export function syncRecordWithoutOfflineDictionary(record: SyncRecord): SyncRecord {
  if (record.kind !== 'word' || !record.analysis?.startsWith(DICTIONARY_SNAPSHOT_PREFIX)) return record;
  let analysis: string | undefined;
  try {
    const snapshots: unknown = JSON.parse(record.analysis.slice(DICTIONARY_SNAPSHOT_PREFIX.length));
    if (Array.isArray(snapshots)) {
      const online = snapshots.filter(snapshot => snapshot && ['bing', 'youdao', 'wordnet'].includes(snapshot.provider));
      if (online.length) analysis = DICTIONARY_SNAPSHOT_PREFIX + JSON.stringify(online);
    }
  } catch { /* Never upload an unparseable dictionary payload. */ }
  return { ...record, analysis };
}
