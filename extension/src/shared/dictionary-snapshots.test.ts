import { beforeEach, expect, it, vi } from 'vitest';
import { persistDictionarySnapshot, type DictionarySnapshot } from './dictionary-snapshots';
import { DICTIONARY_SNAPSHOT_PREFIX, syncRecordWithoutOfflineDictionary } from './learning-sync';

const mocks = vi.hoisted(() => ({ save: vi.fn(), send: vi.fn() }));
vi.mock('./sidebar-history', () => ({ saveDictionarySnapshot: mocks.save }));
vi.mock('./messaging', () => ({ sendMessage: mocks.send }));
const offline: DictionarySnapshot = { provider: 'offline', name: 'Local dictionary', language: 'en', lemma: 'learn', senses: [{ partOfSpeech: 'v.', definitions: ['private offline definition'], examples: [] }] };
const online: DictionarySnapshot = { ...offline, provider: 'bing', name: 'Bing', senses: [{ partOfSpeech: 'v.', definitions: ['online definition'], examples: [] }] };
beforeEach(() => { mocks.save.mockReset(); mocks.send.mockReset(); });

it('does not persist or enqueue offline dictionary contents', async () => {
  await persistDictionarySnapshot('learn', offline, 30, 'record-1');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('syncs online results without old offline snapshots in local history', async () => {
  mocks.save.mockResolvedValue([{ type: 'dictionary', id: 'record-1', dictionarySnapshots: [offline, online] }]);
  await persistDictionarySnapshot('learn', online, 30, 'record-1');
  expect(mocks.save).toHaveBeenCalledWith('record-1', online, 30);
  const { record } = mocks.send.mock.calls[0]![0];
  expect(record.analysis).toBe(DICTIONARY_SNAPSHOT_PREFIX + JSON.stringify([online]));
  expect(JSON.stringify(record)).not.toContain('private offline definition');
  expect(record.text).toBe('learn');
});

it('drops malformed snapshots and preserves ordinary analysis and word metadata', () => {
  const record = { clientRecordId: '1', kind: 'word' as const, text: 'learn', videoId: '', startSeconds: 0 };
  for (const content of ['invalid-json', '{}', JSON.stringify([offline])]) {
    expect(syncRecordWithoutOfflineDictionary({ ...record, analysis: DICTIONARY_SNAPSHOT_PREFIX + content })).toEqual({ ...record, analysis: undefined });
  }
  expect(syncRecordWithoutOfflineDictionary({ ...record, analysis: 'ordinary analysis' }).analysis).toBe('ordinary analysis');
});
