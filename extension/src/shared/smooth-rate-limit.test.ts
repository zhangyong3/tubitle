import { describe, expect, it } from "vitest";
import { SmoothRateLimit } from "./smooth-rate-limit";

describe("SmoothRateLimit", () => {
  it("spaces concurrent reservations across the configured interval", () => {
    const limit = new SmoothRateLimit(240);
    expect([limit.reserve(1000), limit.reserve(1000), limit.reserve(1000)]).toEqual([0, 240, 480]);
    expect(limit.reserve(1240)).toBe(480);
  });

  it("starts immediately again after an idle period", () => {
    const limit = new SmoothRateLimit(240);
    limit.reserve(1000);
    expect(limit.reserve(2000)).toBe(0);
  });
});
