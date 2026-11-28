import type { AudioSegment } from './podcast';

export function podcastTimeAt(
  parts: Pick<AudioSegment, 'durationMs'>[],
  index: number,
  offsetMs: number
) {
  const safeIndex = Math.max(0, Math.min(index, parts.length - 1));
  return (
    parts.slice(0, safeIndex).reduce((sum, part) => sum + part.durationMs, 0) +
    Math.max(0, Math.min(offsetMs, parts[safeIndex]?.durationMs || 0))
  );
}
export function podcastPositionAt(
  parts: Pick<AudioSegment, 'durationMs'>[],
  timeMs: number
) {
  let remaining = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  for (let index = 0; index < parts.length; index++) {
    if (remaining < parts[index].durationMs || index === parts.length - 1)
      return { index, offsetMs: Math.min(remaining, parts[index].durationMs) };
    remaining -= parts[index].durationMs;
  }
  return { index: 0, offsetMs: 0 };
}
export function podcastClock(timeMs: number) {
  const seconds = Math.floor(Math.max(0, timeMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
