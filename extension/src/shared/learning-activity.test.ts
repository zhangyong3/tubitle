import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackActivity, learningDay, addDailyLearning, readDailyLearning } from './learning-activity';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const now = new Date('2026-11-18T10:00:00Z').getTime();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  let stored: Record<string, unknown> = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: async () => structuredClone(stored), set: async (value: Record<string, unknown>) => { stored = { ...stored, ...structuredClone(value) }; },
  } } });
});

it('counts playback sentences once, accumulates wall time, and excludes pauses, seeks and stalls', () => {
  const report = vi.fn(); const activity = new PlaybackActivity(report);
  const tick = (at: number, position: number, sentenceId: string, playing = true) => activity.update({ at, position, videoId: 'video', sentenceId, playing, rate: 1 }, now);
  tick(0, 0, 'one'); tick(1000, 1000, 'one'); tick(2000, 2000, 'two');
  tick(3000, 50000, 'three'); // Seek doesn't add 48 seconds.
  tick(4000, 50000, 'three'); // Buffering doesn't add time.
  tick(5000, 50000, 'three', false);
  expect(report).toHaveBeenLastCalledWith({ day: '2026-11-18', sentences: 3, durationMs: 2000 });
  tick(6000, 1000, 'one'); tick(7000, 2000, 'two'); activity.flush();
  expect(report).toHaveBeenLastCalledWith({ day: '2026-11-18', sentences: 0, durationMs: 1000 });
});

it('keeps only per-account current-day totals and resets at Beijing midnight', async () => {
  await Promise.all(Array.from({ length: 5 }, () => addDailyLearning('alice', { day: learningDay(), sentences: 2, durationMs: 1000 })));
  expect(await readDailyLearning('alice')).toEqual({ sentences: 10, durationMs: 5000 });
  expect(await readDailyLearning('bob')).toEqual({ sentences: 0, durationMs: 0 });
  vi.setSystemTime(new Date('2026-11-18T16:00:00Z'));
  expect(learningDay()).toBe('2026-11-19');
  expect(await readDailyLearning('alice')).toEqual({ sentences: 0, durationMs: 0 });
  await addDailyLearning('alice', { day: '2026-11-18', sentences: 2, durationMs: 1000 });
  expect(await readDailyLearning('alice')).toEqual({ sentences: 0, durationMs: 0 });
  vi.useRealTimers();
});
