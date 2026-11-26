import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterRecentHistory, groupHistoryByDate, parseSidebarHistory, saveDictionarySnapshot, recordDictionaryHistory, recordAnalysisHistory, pruneSidebarHistory, deleteSidebarHistory, SIDEBAR_HISTORY_KEY, type SidebarHistoryEntry } from './sidebar-history';
import { getSettings, updateSettings } from './settings';
import { historyCutoff, normalizeHistoryDays } from './history-retention';
import { historyNavigationAction, historyVideoTarget } from './history-navigation';

let stored: Record<string, unknown>;
beforeEach(() => {
  stored = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => structuredClone(stored)),
    set: vi.fn(async (value) => { stored = { ...stored, ...structuredClone(value) }; }),
    remove: vi.fn(async (key: string) => { delete stored[key]; })
  } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const word = (id: string, createdAt: number): SidebarHistoryEntry => ({ id, type: 'dictionary', word: id, createdAt });
describe('history by calendar day', () => {
  it('retains all entries within the configured local days, with no per-type count cap', () => {
    const now = new Date(2026, 10, 16, 15).getTime();
    const cutoff = new Date(2026, 10, 15).getTime();
    const entries = Array.from({ length: 150 }, (_, i) => word(String(i), now - i));
    entries.push(word('boundary', cutoff), word('expired', cutoff - 1));
    const result = filterRecentHistory(entries, 2, now);
    expect(result).toHaveLength(151);
    expect(result.at(-1)?.id).toBe('boundary');
    expect(filterRecentHistory(entries, 1, now)).toHaveLength(150);
  });
  it('groups local dates newest first and keeps entries newest first within a date', () => {
    const groups = groupHistoryByDate([
      word('yesterday', new Date(2026, 10, 15, 23, 59).getTime()),
      word('morning', new Date(2026, 10, 16, 1).getTime()),
      word('evening', new Date(2026, 10, 16, 19).getTime())
    ]);
    expect(groups.map((group) => group.date)).toEqual(['2026-11-16', '2026-11-15']);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['evening', 'morning']);
  });
  it('uses calendar midnights across daylight-saving changes', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const now = new Date(2026, 2, 9, 14).getTime();
    expect(historyCutoff(2, now)).toBe(new Date(2026, 2, 8).getTime());
    expect(historyCutoff(1, now) - historyCutoff(2, now)).toBe(23 * 3600000);
  });
  it('migrates the old item count to a 30-day default and bounds new settings', async () => {
    stored.settings = { settingsVersion: 7, historyLimit: 2 };
    const settings = await getSettings();
    expect(settings.historyRetentionDays).toBe(30);
    expect(settings).not.toHaveProperty('historyLimit');
    expect((await updateSettings({ historyRetentionDays: 900 })).historyRetentionDays).toBe(365);
    expect(normalizeHistoryDays(0)).toBe(1);
    expect(normalizeHistoryDays(NaN)).toBe(30);
  });
  it('deduplicates repeated words and keeps the latest date and video position', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 10));
    await recordDictionaryHistory('show', 30, { videoId: 'abcdefghijk', startMs: 1234, videoTitle: 'First video' });
    vi.setSystemTime(new Date(2026, 10, 16, 10));
    const entries = await recordDictionaryHistory('show', 30, { videoId: 'lmnopqrstuv', startMs: 4567 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ videoId: 'lmnopqrstuv', startMs: 4567 });
    expect(groupHistoryByDate(entries)).toHaveLength(1);
    await recordAnalysisHistory({ requestId: 'qa', sentence: 'Show up.', createdAt: Date.now(), videoId: 'abcdefghijk', videoTitle: 'A video', startMs: 9900 }, 'A full analysis', 30);
    expect((stored[SIDEBAR_HISTORY_KEY] as SidebarHistoryEntry[])[0]).toMatchObject({ type: 'analysis', videoTitle: 'A video', startMs: 9900 });
  });
  it('deduplicates sentence analyses and manually deletes local history', async () => {
    await recordAnalysisHistory({ requestId: 'a', sentence: 'Show   up.', createdAt: Date.now() }, 'First', 30);
    const entries = await recordAnalysisHistory({ requestId: 'b', sentence: 'show up.', createdAt: Date.now() + 1 }, 'Latest', 30);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ result: 'Latest' });
    stored.learningSyncState = { queue: [{ clientRecordId: 'pending' }] };
    expect(await deleteSidebarHistory(entries[0]!.id)).toEqual([]);
    expect(stored.learningSyncState).toEqual({ queue: [{ clientRecordId: 'pending' }] });
  });
  it('physically removes expired local history without touching the upload queue', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 16, 10));
    stored[SIDEBAR_HISTORY_KEY] = [word('today', Date.now()), word('expired', new Date(2026, 10, 14).getTime())];
    stored.learningSyncState = { queue: [{ clientRecordId: 'pending' }] };
    await pruneSidebarHistory(2);
    expect((stored[SIDEBAR_HISTORY_KEY] as SidebarHistoryEntry[]).map((entry) => entry.id)).toEqual(['today']);
    expect(stored.learningSyncState).toEqual({ queue: [{ clientRecordId: 'pending' }] });
  });
  it('rejects invalid dates and incomplete saved analyses', () => {
    expect(parseSidebarHistory([
      { id: 'bad', type: 'analysis', requestId: 'r', sentence: 'Sentence', result: '', createdAt: 2 },
      word('invalid', NaN), word('overflow', 1e20), word('good', 1)
    ]).map((entry) => entry.id)).toEqual(['good']);
  });
});
describe('history playback', () => {
  it('seeks the current video exactly and builds a source URL for another video', () => {
    const entry = { videoId: 'abcdefghijk', startMs: 125500 };
    expect(historyNavigationAction(entry, 'abcdefghijk')).toEqual({ type: 'seek', seconds: 125.5 });
    expect(historyNavigationAction(entry, 'lmnopqrstuv')).toEqual({ type: 'navigate', url: 'https://www.youtube.com/watch?v=abcdefghijk&t=125s' });
    expect(historyVideoTarget({ videoId: 'abcdefghijk', startMs: 0 })?.startMs).toBe(0);
  });
  it('does not invent positions for legacy entries or accept arbitrary URLs', () => {
    for (const entry of [{}, { videoId: 'abcdefghijk' }, { videoId: 'javascript:alert(1)', startMs: 0 }, { videoId: 'abcdefghijk', startMs: -1 }, { videoId: 'abcdefghijk', startMs: Infinity }]) expect(historyNavigationAction(entry, 'abcdefghijk')).toBeNull();
  });
});

it('merges dictionary results on the exact saved lookup without overwriting a newer lookup', async () => {
 const first=await recordDictionaryHistory('actually',30,{videoId:'abcdefghijk'});
 const id=first[0]!.id;
 const source={provider:'youdao',name:'有道词典',language:'en',lemma:'actually',senses:[{partOfSpeech:'adv.',definitions:['实际上'],examples:[]}]};
 await Promise.all([saveDictionarySnapshot(id,source,30),saveDictionarySnapshot(id,{...source,provider:'wordnet',name:'WordNet'},30)]);
 const entries=parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]);
 expect(entries[0]?.type==='dictionary' && entries[0].dictionarySnapshots).toHaveLength(2);
 const next=await recordDictionaryHistory('actually',30);
 await saveDictionarySnapshot(id,{...source,lemma:'stale'},30);
 const latest=parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY])[0];
 expect(latest?.id).toBe(next[0]?.id);
 expect(latest?.type==='dictionary' && latest.dictionarySnapshots).toBeUndefined();
});
