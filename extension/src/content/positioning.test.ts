import { describe, expect, it } from "vitest";
import { normalizeSubtitlePosition, positionToViewport, viewportToPosition } from "./positioning";

const bounds = { left: 100, top: 50, width: 800, height: 450 };

describe("subtitle positioning", () => {
  it("places the default subtitle in the lower middle of the video", () => {
    expect(positionToViewport(bounds, { xPercent: 50, yPercent: 74 })).toEqual({ x: 500, y: 383 });
  });

  it("converts a dragged viewport point to video-relative percentages", () => {
    expect(viewportToPosition(bounds, 300, 275)).toEqual({ xPercent: 25, yPercent: 50 });
  });

  it("keeps dragged subtitles inside the video", () => {
    expect(normalizeSubtitlePosition({ xPercent: -20, yPercent: 120 })).toEqual({ xPercent: 4, yPercent: 94 });
  });
});
