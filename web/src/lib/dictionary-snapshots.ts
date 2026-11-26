import { z } from 'zod';
export const DICTIONARY_SNAPSHOT_PREFIX = 'tubitle-dictionaries-v1:';
const snapshots = z.array(z.object({
  provider: z.enum(['bing', 'youdao', 'wordnet', 'offline']),
  name: z.string().max(100), language: z.string().max(40), lemma: z.string().max(200),
  phonetics: z.array(z.string().max(200)).max(3).optional(),
  senses: z.array(z.object({ partOfSpeech: z.string().max(100), definitions: z.array(z.string().max(8000)).max(8), examples: z.array(z.string().max(2000)).max(3) })).max(20),
})).max(4);
export function readDictionarySnapshots(value: string | null | undefined) {
  if (!value?.startsWith(DICTIONARY_SNAPSHOT_PREFIX) || value.length > 50000) return [];
  try { const result = snapshots.safeParse(JSON.parse(value.slice(DICTIONARY_SNAPSHOT_PREFIX.length))); return result.success ? result.data : []; } catch { return []; }
}
