import type { SubtitlePosition } from "../shared/types";

export interface VideoBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clampNumber(value: number, minimum: number, maximum: number, fallback: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : fallback));
}

export function normalizeSubtitlePosition(position: SubtitlePosition): SubtitlePosition {
  return {
    xPercent: clampNumber(position.xPercent, 4, 96, 50),
    yPercent: clampNumber(position.yPercent, 8, 94, 74)
  };
}

export function positionToViewport(bounds: VideoBounds, position: SubtitlePosition) {
  const normalized = normalizeSubtitlePosition(position);
  return {
    x: bounds.left + (bounds.width * normalized.xPercent) / 100,
    y: bounds.top + (bounds.height * normalized.yPercent) / 100
  };
}

export function viewportToPosition(bounds: VideoBounds, x: number, y: number): SubtitlePosition {
  return normalizeSubtitlePosition({
    xPercent: ((x - bounds.left) / bounds.width) * 100,
    yPercent: ((y - bounds.top) / bounds.height) * 100
  });
}
