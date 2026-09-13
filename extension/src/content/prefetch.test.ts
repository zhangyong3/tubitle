import { describe, expect, it } from "vitest";
import { prefetchBatchPlan, prefetchSentenceIndexes } from "./prefetch";

describe("translation prefetch window", () => {
  it("selects exactly the next 15 sentences", () => {
    const indexes = prefetchSentenceIndexes(4, 100);
    expect(indexes).toHaveLength(15);
    expect(indexes[0]).toBe(5);
    expect(indexes.at(-1)).toBe(19);
  });

  it("stops at the end of the captions", () => {
    expect(prefetchSentenceIndexes(7, 10)).toEqual([8, 9]);
  });
});

describe("translation batch prefetch plan", () => {
  it("loads one batch initially and refills when 40% remains", () => {
    const initial = prefetchBatchPlan(0, 100);
    expect(initial.indexes).toEqual(Array.from({ length: 15 }, (_, index) => index));

    const noRefill = prefetchBatchPlan(8, 100, initial.state);
    expect(noRefill.indexes).toEqual([]);

    const refill = prefetchBatchPlan(9, 100, noRefill.state);
    expect(refill.indexes).toEqual(Array.from({ length: 15 }, (_, index) => index + 15));
  });

  it("starts one fresh batch after a forward seek", () => {
    const plan = prefetchBatchPlan(100, 200, { cursor: 45, lastIndex: 14 });
    expect(plan.indexes[0]).toBe(100);
    expect(plan.indexes.at(-1)).toBe(114);
  });

  it("supports configurable batch size and refill ratio", () => {
    const initial = prefetchBatchPlan(0, 100, undefined, 10, 0.4);
    expect(initial.indexes).toEqual(Array.from({ length: 10 }, (_, index) => index));

    const noRefill = prefetchBatchPlan(5, 100, initial.state, 10, 0.4);
    expect(noRefill.indexes).toEqual([]);

    const refill = prefetchBatchPlan(6, 100, noRefill.state, 10, 0.4);
    expect(refill.indexes).toEqual(Array.from({ length: 10 }, (_, index) => index + 10));
  });

  it("allows a partial final batch at the end of the video", () => {
    const plan = prefetchBatchPlan(92, 100);
    expect(plan.indexes).toEqual([92, 93, 94, 95, 96, 97, 98, 99]);
  });
});
