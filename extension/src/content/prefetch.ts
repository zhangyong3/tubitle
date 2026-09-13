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
  batchSize = 15,
  refillRatio = 0.4
): { indexes: number[]; state: PrefetchBatchState } {
  const size = Math.max(1, batchSize);
  const refillThreshold = Math.ceil(size * Math.min(1, Math.max(0, refillRatio)));
  const reset = !previous || currentIndex < previous.lastIndex || currentIndex >= previous.cursor;
  const start = Math.max(0, reset ? currentIndex : previous.cursor);
  const shouldRefill = start - currentIndex <= refillThreshold;
  const batches = reset || shouldRefill ? 1 : 0;
  const end = Math.min(totalSentences, start + batches * size);
  return {
    indexes: Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset),
    state: { cursor: end, lastIndex: currentIndex }
  };
}
