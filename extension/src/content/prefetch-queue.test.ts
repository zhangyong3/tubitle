import { afterEach, expect, it, vi } from 'vitest';
import { PrefetchQueue } from './prefetch-queue';
afterEach(() => vi.useRealTimers());

it('bounds viewport work, deduplicates and runs only two prefetch requests at once', async () => {
  const finish: Array<() => void> = [];
  const run = vi.fn(() => new Promise<void>(resolve => finish.push(resolve)));
  const queue = new PrefetchQueue<number>({ run, onError: vi.fn() });
  for (let index = 0; index < 30; index++) queue.add(String(index), index);
  expect(run).toHaveBeenCalledTimes(2);
  expect(queue.size).toBe(17);
  expect(queue.add('0', 0)).toBe(false);
  expect(queue.add('30', 30)).toBe(false);
  finish[0]!();
  await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(3);
  queue.clear();
  finish.slice(1).forEach(resolve => resolve());
  await Promise.resolve();
  expect(queue.idle).toBe(true);
});

it('retains queued work during 429 cooldown and honors Retry-After before retrying', async () => {
  vi.useFakeTimers();
  const error = Object.assign(new Error('429'), {status:429, retryAfterMs:10000});
  const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const onError = vi.fn();
  const queue = new PrefetchQueue<number>({ run, onError, concurrency:1 });
  queue.add('first', 1); queue.add('second', 2);
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.size).toBe(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run.mock.calls.map(call => call[0])).toEqual([1,1,2]);
  expect(queue.idle).toBe(true);
  expect(onError).toHaveBeenCalledOnce();
});

it('retries a transient failure at most twice without dropping later tasks', async () => {
  vi.useFakeTimers();
  const run = vi.fn(async (value: number) => { if (value === 1) throw new Error('offline'); });
  const queue = new PrefetchQueue<number>({ run, onError:vi.fn(), concurrency:1 });
  queue.add('bad', 1); queue.add('good', 2);
  await vi.runAllTimersAsync();
  expect(run.mock.calls.map(call => call[0])).toEqual([1,1,1,2]);
  expect(queue.idle).toBe(true);
});

it('does not retry permanent errors', async () => {
  const run = vi.fn().mockRejectedValue(Object.assign(new Error('login required'), {status:401}));
  const queue = new PrefetchQueue<number>({ run, onError:vi.fn() });
  queue.add('one', 1);
  await Promise.resolve();
  expect(run).toHaveBeenCalledOnce();
  expect(queue.idle).toBe(true);
});

it('a seek discards old queued work and does not resurrect old failed tasks', async () => {
  let reject!: (error: Error) => void;
  const run = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const queue = new PrefetchQueue<number>({ run, onError:vi.fn(), concurrency:1 });
  queue.add('old-active', 1); queue.add('old-queued', 2);
  queue.clear(false);
  queue.add('new', 100);
  reject(new Error('old failure'));
  await Promise.resolve(); await Promise.resolve();
  expect(run.mock.calls.map(call => call[0])).toEqual([1,100]);
  expect(queue.idle).toBe(true);
});

it('a seek preserves cooldown, while session reset clears its timer', async () => {
  vi.useFakeTimers();
  const run = vi.fn().mockRejectedValueOnce(Object.assign(new Error('limit'), {status:429, retryAfterMs:10000})).mockResolvedValue(undefined);
  const queue = new PrefetchQueue<number>({ run, onError:vi.fn(), concurrency:1 });
  queue.add('old', 1);
  await vi.advanceTimersByTimeAsync(0);
  queue.clear(false); queue.add('seek', 100);
  await vi.advanceTimersByTimeAsync(9999);
  expect(run).toHaveBeenCalledOnce();
  queue.clear();
  expect(vi.getTimerCount()).toBe(0);
  queue.add('new-session', 200);
  await vi.advanceTimersByTimeAsync(0);
  expect(run.mock.calls.map(call => call[0])).toEqual([1,200]);
});
