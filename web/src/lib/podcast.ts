import { z } from 'zod';

export const DAY_MS = 86400000;
export const RETENTION_MS = 30 * DAY_MS;
export const PODCAST_INTERVAL_MS = 3 * DAY_MS;
export const MAX_PODCAST_SEGMENTS = 96;
export const podcastLanguages = [
  'en',
  'zh',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'ru',
  'it',
  'ar',
  'th',
  'vi',
] as const;
export const languageCode = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/)
  .max(35);
export function normalizePodcastLanguage(value: string): string {
  const tag = Intl.getCanonicalLocales(value)[0];
  if (!tag) throw new Error('INVALID_LANGUAGE');
  return tag;
}
export const scriptSchema = z
  .object({
    title: z.string().min(1).max(150),
    segments: z
      .array(
        z
          .object({
            language: languageCode,
            sourceRecordIds: z.array(z.string().min(1).max(191)).min(1).max(8),
            spokenText: z.string().min(1).max(1400),
          })
          .strict()
      )
      .min(5)
      .max(MAX_PODCAST_SEGMENTS),
  })
  .strict();
export type PodcastScript = z.infer<typeof scriptSchema>;
export type AudioSegment = { key: string; durationMs: number };
// New scripts use a separate, contiguous block per record. Old saved scripts
// still use validateScript when read; this check only gates new generation.
export function validateTeachingOrder(
  script: PodcastScript,
  source: string,
  target: string,
  records?: { id: string; kind?: string; text?: string; context?: string }[]
) {
  if (!records) {
    // Compatibility for callers validating the earlier six-part format.
    if (script.segments.length % 6 !== 0)
      throw new Error('SCRIPT_TEACHING_ORDER');
    for (let start = 0; start < script.segments.length; start += 6) {
      const ids = [...script.segments[start].sourceRecordIds]
        .sort()
        .join('\u0000');
      for (let offset = 0; offset < 6; offset++) {
        const segment = script.segments[start + offset];
        if (
          segment.language.toLowerCase() !==
            (offset % 2 === 0 ? source : target).toLowerCase() ||
          [...segment.sourceRecordIds].sort().join('\u0000') !== ids
        )
          throw new Error('SCRIPT_TEACHING_ORDER');
      }
    }
    return script;
  }
  const known = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const sentences = new Intl.Segmenter(target, { granularity: 'sentence' });
  const normalize = (text: string) =>
    text
      .normalize('NFKC')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  for (let start = 0; start < script.segments.length;) {
    const first = script.segments[start];
    const id = first.sourceRecordIds[0],
      record = known.get(id);
    if (!record || seen.has(id) || first.sourceRecordIds.length !== 1)
      throw new Error('SCRIPT_TEACHING_ORDER');
    seen.add(id);
    let end = start;
    while (
      end < script.segments.length &&
      script.segments[end].sourceRecordIds[0] === id
    ) {
      const segment = script.segments[end];
      if (
        segment.sourceRecordIds.length !== 1 ||
        segment.language.toLowerCase() !==
          ((end - start) % 2 === 0 ? source : target).toLowerCase()
      )
        throw new Error('SCRIPT_TEACHING_ORDER');
      if (
        (end - start) % 2 === 1 &&
        ([...sentences.segment(segment.spokenText)].filter((s) =>
          s.segment.trim()
        ).length > 2 ||
          (/^zh(?:-|$)/i.test(target) &&
            (segment.spokenText.match(/\p{Script=Han}/gu)?.length || 0) > 45))
      )
        throw new Error('SCRIPT_EXPLANATION_TOO_LONG');
      end++;
    }
    const count = end - start;
    if (
      count < 2 ||
      count % 2 !== 0 ||
      (record.kind === 'word' && count !== 6) ||
      (record.kind === 'sentence' && count > 6)
    )
      throw new Error('SCRIPT_TEACHING_ORDER');
    const original =
      record.kind === 'word'
        ? record.context?.trim() || record.text
        : record.text;
    if (original && normalize(first.spokenText) !== normalize(original))
      throw new Error('SCRIPT_ORIGINAL_SENTENCE');
    start = end;
  }
  if (seen.size !== known.size) throw new Error('SCRIPT_COVERAGE');
  return script;
}
export function validateScript(
  raw: unknown,
  sources: { id: string }[],
  source: string,
  target: string
): PodcastScript {
  const script = scriptSchema.parse(raw);
  const ids = new Set(sources.map((s) => s.id));
  const covered = new Set<string>();
  for (const segment of script.segments) {
    if (
      ![source.toLowerCase(), target.toLowerCase()].includes(
        segment.language.toLowerCase()
      )
    )
      throw new Error('SCRIPT_LANGUAGE');
    if (new TextEncoder().encode(segment.spokenText).length > 3900)
      throw new Error('SCRIPT_TOO_LONG');
    for (const id of segment.sourceRecordIds) {
      if (!ids.has(id)) throw new Error('SCRIPT_SOURCE');
      covered.add(id);
    }
  }
  if (covered.size !== ids.size) throw new Error('SCRIPT_COVERAGE');
  return script;
}
export function usageDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
export function oldestUsageDay(now = new Date()) {
  return usageDay(new Date(now.getTime() - 29 * DAY_MS));
}
export function validActivityDay(day: string, now = new Date()) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    day <= usageDay(now) &&
    day >= usageDay(new Date(now.getTime() - 6 * DAY_MS)) &&
    new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
  );
}
export class PodcastError extends Error {
  constructor(
    public code: string,
    public status = 409
  ) {
    super(code);
  }
}
