export interface DailyLearningStats { sentences: number; durationMs: number }
export interface LearningActivity extends DailyLearningStats { day: string }
export function learningDay(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

// Count actual playback only. Prefetch, seeks, pauses and buffering add nothing.
// Deduplication is bounded to the current day in this page, never sent to a server.
export class PlaybackActivity {
  private day = '';
  private seen = new Set<string>();
  private previous?: { at: number; position: number; videoId: string; playing: boolean };
  private pending: DailyLearningStats = { sentences: 0, durationMs: 0 };
  private lastFlush = 0;
  constructor(private report: (activity: LearningActivity, synchronize?: boolean) => void) {}
  update(input: { at: number; position: number; videoId: string; sentenceId?: string; playing: boolean; rate: number }, now = Date.now()): void {
    const day = learningDay(now);
    if (day !== this.day) {
      this.flush(); this.day = day; this.seen.clear(); this.previous = undefined;
    }
    const previous = this.previous;
    this.previous = input;
    if (input.playing) {
      const elapsed = previous ? input.at - previous.at : 0;
      const advance = previous ? input.position - previous.position : 0;
      if (previous?.playing && previous.videoId === input.videoId && elapsed > 0 && elapsed <= 2000 && advance > 0 && advance <= elapsed * input.rate + 500) {
        this.pending.durationMs += elapsed;
      }
      const key = `${input.videoId}:${input.sentenceId}`;
      if (input.sentenceId && !this.seen.has(key)) {
        if (this.seen.size >= 20000) this.seen.delete(this.seen.values().next().value!);
        this.seen.add(key); this.pending.sentences++;
      }
    }
    if (input.at - this.lastFlush >= 15000 || (!input.playing && previous?.playing)) {
      this.lastFlush = input.at; this.flush();
    }
  }
  flush(synchronize = false): void {
    if (this.pending.sentences || this.pending.durationMs || synchronize) {
      const activity = { day: this.day || learningDay(), sentences: this.pending.sentences, durationMs: Math.round(this.pending.durationMs) };
      if (synchronize) this.report(activity, true);
      else this.report(activity);
      this.pending = { sentences: 0, durationMs: 0 };
    }
  }
}

const STORAGE_KEY = 'dailyLearningTotals';
interface StoredTotals { day: string; accounts: Record<string, DailyLearningStats> }
let writing: Promise<unknown> = Promise.resolve();
export async function readDailyLearning(userId: string): Promise<DailyLearningStats> {
  await writing;
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as StoredTotals | undefined;
  return stored?.day === learningDay() ? stored.accounts[userId] ?? { sentences: 0, durationMs: 0 } : { sentences: 0, durationMs: 0 };
}
export function addDailyLearning(userId: string, activity: LearningActivity): Promise<void> {
  const task = writing.catch(() => undefined).then(async () => {
    if (activity.day !== learningDay() || !Number.isInteger(activity.sentences) || activity.sentences < 0 || activity.sentences > 20000 || !Number.isFinite(activity.durationMs) || activity.durationMs < 0 || activity.durationMs > 30000) return;
    let stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as StoredTotals | undefined;
    if (stored?.day !== activity.day) stored = { day: activity.day, accounts: {} };
    const previous = stored.accounts[userId] ?? { sentences: 0, durationMs: 0 };
    if (!stored.accounts[userId] && Object.keys(stored.accounts).length >= 20) delete stored.accounts[Object.keys(stored.accounts)[0]!];
    stored.accounts[userId] = { sentences: previous.sentences + activity.sentences, durationMs: previous.durationMs + activity.durationMs };
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  });
  writing = task;
  return task;
}
