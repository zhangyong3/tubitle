import { DICTIONARY_SNAPSHOT_PREFIX, syncRecordWithoutOfflineDictionary } from './learning-sync';
import { sendMessage } from './messaging';
import { saveDictionarySnapshot } from './sidebar-history';
export interface DictionarySnapshot {
  provider: string;
  name: string;
  language: string;
  lemma: string;
  phonetics?: string[];
  senses: Array<{ partOfSpeech: string; definitions: string[]; examples: string[] }>;
}
export { DICTIONARY_SNAPSHOT_PREFIX } from './learning-sync';
export async function persistDictionarySnapshot(word: string, snapshot: DictionarySnapshot, days: number, recordId: string) {
  if (snapshot.provider === 'offline') return;
  const entries = await saveDictionarySnapshot(recordId, snapshot, days);
  const entry = entries.find(item => item.type === 'dictionary' && item.id === recordId);
  if (entry?.type !== 'dictionary' || !entry.dictionarySnapshots?.length) return;
  await sendMessage({ type: 'LEARNING_SYNC_ENQUEUE', record: syncRecordWithoutOfflineDictionary({
    clientRecordId: entry.id, kind: 'word', text: word,
    context: entry.context || '', analysis: DICTIONARY_SNAPSHOT_PREFIX + JSON.stringify(entry.dictionarySnapshots),
    videoId: entry.videoId || '', videoTitle: entry.videoTitle || '',
    startSeconds: Math.max(0, Math.floor((entry.startMs || 0) / 1000)),
  }) });
}
