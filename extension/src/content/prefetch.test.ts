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
  it("starts with 15 and replenishes only 5 when five planned sentences remain", () => {
    let plan = prefetchBatchPlan(0, 100);
    expect(plan.indexes).toEqual(Array.from({ length: 15 }, (_, i) => i));
    for (let index = 1; index <= 9; index++) {
      plan = prefetchBatchPlan(index, 100, plan.state);
      expect(plan.indexes).toEqual([]);
    }
    plan = prefetchBatchPlan(10, 100, plan.state);
    expect(plan.indexes).toEqual([15, 16, 17, 18, 19]);
    expect(prefetchBatchPlan(10, 100, plan.state).indexes).toEqual([]);
    for (let index = 11; index <= 14; index++) plan = prefetchBatchPlan(index, 100, plan.state);
    expect(prefetchBatchPlan(15, 100, plan.state).indexes).toEqual([20, 21, 22, 23, 24]);
  });
  it("starts a fresh 15 after seeking in either direction, including within the old window", () => {
    for (const index of [5, 12, 100]) {
      const plan = prefetchBatchPlan(index, 200, { cursor: 20, lastIndex: 10 });
      expect(plan.reset).toBe(true);
      expect(plan.indexes).toEqual(Array.from({length:15}, (_, i) => index + i));
    }
  });
  it("clamps initial and incremental batches at the end", () => {
    expect(prefetchBatchPlan(92, 100).indexes).toEqual([92, 93, 94, 95, 96, 97, 98, 99]);
    expect(prefetchBatchPlan(94, 100, {cursor:98,lastIndex:93}).indexes).toEqual([98,99]);
    expect(prefetchBatchPlan(99, 100, {cursor:100,lastIndex:98}).indexes).toEqual([]);
  });
  it("does not stack batches while pending, but tracks playback and refills once idle", () => {
    let plan = prefetchBatchPlan(0, 100);
    for (let index = 1; index <= 12; index++) {
      plan = prefetchBatchPlan(index, 100, plan.state, {busy:true});
      expect(plan.reset).toBe(false);
      expect(plan.indexes).toEqual([]);
      expect(plan.state.cursor).toBe(15);
    }
    expect(prefetchBatchPlan(12, 100, plan.state).indexes).toEqual([15,16,17,18,19]);
    expect(prefetchBatchPlan(50, 100, plan.state, {busy:true}).indexes).toHaveLength(15);
  });
});
