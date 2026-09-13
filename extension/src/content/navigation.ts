import type { CaptionSentence } from "../shared/types";

export type NavigationDirection = -1 | 0 | 1;

export function findSentenceIndex(sentences: CaptionSentence[], timeMs: number): number {
  if (sentences.length === 0 || !Number.isFinite(timeMs)) return -1;
  const candidate = indexAtOrBefore(sentences, timeMs);
  if (candidate < 0) return -1;
  return timeMs <= sentences[candidate]!.endMs + 220 ? candidate : -1;
}

export function navigationTargetIndex(
  sentences: CaptionSentence[],
  timeMs: number,
  direction: NavigationDirection
): number {
  if (sentences.length === 0 || !Number.isFinite(timeMs)) return -1;
  const current = findSentenceIndex(sentences, timeMs);
  if (current >= 0) return clampIndex(current + direction, sentences.length);

  const previous = indexAtOrBefore(sentences, timeMs);
  if (direction < 0) return previous >= 0 ? previous : 0;
  if (direction > 0) return Math.min(sentences.length - 1, previous + 1);
  return previous >= 0 ? previous : 0;
}

function indexAtOrBefore(sentences: CaptionSentence[], timeMs: number): number {
  let low = 0;
  let high = sentences.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (sentences[mid]!.startMs <= timeMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate;
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index));
}
