import type { SidebarHistoryEntry } from './sidebar-history';
export interface HistoryVideoTarget { videoId: string; startMs: number; url: string }
export function historyVideoTarget(entry: Pick<SidebarHistoryEntry, 'videoId' | 'startMs'>): HistoryVideoTarget | null {
  if (!entry.videoId || !/^[A-Za-z0-9_-]{11}$/.test(entry.videoId) || typeof entry.startMs !== 'number' || !Number.isFinite(entry.startMs) || entry.startMs < 0 || entry.startMs > 604800000) return null;
  return { videoId: entry.videoId, startMs: entry.startMs, url: `https://www.youtube.com/watch?v=${entry.videoId}&t=${Math.floor(entry.startMs / 1000)}s` };
}
export function historyNavigationAction(entry: Pick<SidebarHistoryEntry, 'videoId' | 'startMs'>, currentVideoId: string | null) {
  const target = historyVideoTarget(entry);
  if (!target) return null;
  return target.videoId === currentVideoId
    ? { type: 'seek' as const, seconds: target.startMs / 1000 }
    : { type: 'navigate' as const, url: target.url };
}
