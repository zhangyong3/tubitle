import { pinyin } from 'pinyin-pro';

// Normalize transcription formatting, not meanings or arbitrary ASR word errors.
export function normalizedSpeech(text: string) {
  const numbers: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  const numeral = Object.keys(numbers).join('|');
  const han: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      new RegExp(`\\b(?:${numeral})(?:[ -]+(?:${numeral}))?\\b`, 'g'),
      (value) => {
        const parts = value.split(/[ -]+/).map((part) => numbers[part]);
        // Only combine a tens word and a ones word; never collapse repeated counts.
        return parts.length === 2 &&
          parts[0] >= 20 &&
          parts[1] > 0 &&
          parts[1] < 10
          ? String(parts[0] + parts[1])
          : parts.map(String).join(' ');
      }
    )
    .replace(
      /\b(at|by|until|before|after|around|from|to)\s+(\d{1,2}):00\b/g,
      '$1 $2'
    )
    .replace(/\b(\d{1,2})\s+o['’]clock\b/g, '$1')
    .replace(
      /[零〇一二两三四五六七八九十]{1,3}(?=年|月|日|点|时|分|秒|个|次|条|段|组)/g,
      (value) => {
        if (value.includes('十')) {
          const [tens, ones] = value.split('十');
          return String((tens ? han[tens] : 1) * 10 + (ones ? han[ones] : 0));
        }
        return value.length === 1 ? String(han[value]) : value;
      }
    )
    .replace(/[^\p{L}\p{N}]/gu, '');
}
export function assertSpeechMatches(
  expected: string,
  actual: string | string[],
  language?: string
) {
  const normalized = normalizedSpeech(expected);
  const candidates = Array.isArray(actual) ? actual : [actual];
  if (
    normalized &&
    candidates.some((candidate) => normalized === normalizedSpeech(candidate))
  )
    return;
  // The same Mandarin syllables and tones are the same spoken content, even
  // when ASR chooses another written homophone. Never apply this to Japanese
  // kanji or accept extra/missing syllables, changed tones, or approximate text.
  if (normalized && /^zh(?:-|$)/i.test(language || '')) {
    const sound = (text: string) =>
      pinyin(text, {
        toneType: 'num',
        type: 'array',
        nonZh: 'consecutive',
      }).join('|');
    const expectedSound = sound(normalized);
    if (
      candidates.some((candidate) => {
        const value = normalizedSpeech(candidate);
        return (
          value.length === normalized.length && sound(value) === expectedSound
        );
      })
    )
      return;
  }
  throw new Error('TTS_TRANSCRIPT_MISMATCH');
}
