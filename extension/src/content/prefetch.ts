export function prefetchSentenceIndexes(
  currentIndex: number,
  totalSentences: number,
  count = 15
): number[] {
  const start = Math.max(0, currentIndex + 1);
  const end = Math.min(totalSentences, start + Math.max(0, count));
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
}

export interface PrefetchBatchState {
  cursor: number;
  lastIndex: number;
}

export function prefetchBatchPlan(
  currentIndex: number,
  totalSentences: number,
  previous?: PrefetchBatchState,
  options: { busy?: boolean; initialSize?: number; incrementSize?: number; refillThreshold?: number } = {}
): { indexes: number[]; state: PrefetchBatchState; reset: boolean } {
  const { initialSize = 15, incrementSize = 5, refillThreshold = 5 } = options;
  const reset = !previous || currentIndex < previous.lastIndex || currentIndex > previous.lastIndex + 1 || currentIndex >= previous.cursor;
  const start = Math.max(0, reset ? currentIndex : previous.cursor);
  const count = reset ? Math.max(1, initialSize) : options.busy ? 0
    : start - currentIndex <= refillThreshold ? Math.max(1, incrementSize) : 0;
  const end = Math.min(totalSentences, start + count);
  return {
    indexes: Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset),
    state: { cursor: end, lastIndex: currentIndex },
    reset,
  };
}
