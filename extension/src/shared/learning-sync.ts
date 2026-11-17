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
  connected: boolean;
  name?: string;
  pending: number;
  lastSyncedAt?: number;
  error?: string;
}
