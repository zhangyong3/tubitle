import { readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem, arch, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';

const fixtures = JSON.parse(await readFile(new URL('./samples.json', import.meta.url), 'utf8'))
  .filter(sample => !process.env.BENCH_TARGET || sample.target === process.env.BENCH_TARGET);
const base = `http://127.0.0.1:${process.env.PORT ?? 18081}`;
const rounds = Number(process.env.BENCH_ROUNDS ?? 4);
const kinds = process.env.BENCH_KIND ? [process.env.BENCH_KIND] : ['subtitle', 'paragraph'];
const concurrencyLevels = process.env.BENCH_CONCURRENCY ? [Number(process.env.BENCH_CONCURRENCY)] : [1, 2, 4];
const output = process.argv[2] ?? 'results/benchmark.json';
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('BENCH_ROUNDS must be a positive integer');
if (!fixtures.length) throw new Error('No benchmark samples for BENCH_TARGET');
if (kinds.some(kind => !fixtures.some(sample => sample.kind === kind))) throw new Error('No benchmark samples for BENCH_KIND');
if (concurrencyLevels.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('BENCH_CONCURRENCY must be a positive integer');

async function translate({ id, text, target }) {
  const start = performance.now();
  try {
    const response = await fetch(`${base}/v1/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target }),
      signal: AbortSignal.timeout(95_000),
    });
    const result = await response.json();
    return { id, elapsedMs: Math.round(performance.now() - start), status: response.status, ...result };
  } catch (error) {
    return { id, elapsedMs: Math.round(performance.now() - start), status: 0, error: error.message };
  }
}

const ready = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
if (!ready.ok) throw new Error('Inference is not ready');

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * fraction) - 1];
}

async function run(kind, concurrency) {
  const samples = fixtures.filter(sample => sample.kind === kind);
  const jobs = Array.from({ length: rounds }, () => samples).flat();
  let next = 0;
  const requests = Array(jobs.length);
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const index = next++;
      requests[index] = await translate(jobs[index]);
    }
  }));
  const wallMs = Math.round(performance.now() - start);
  const successful = requests.filter(row => row.status === 200 && row.finishReason === 'stop');
  const latencies = successful.map(row => row.elapsedMs);
  const tokens = successful.reduce((sum, row) => sum + (row.usage?.completion_tokens ?? 0), 0);
  const summary = {
    kind, concurrency, total: jobs.length, completed: successful.length, wallMs,
    p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95),
    requestsPerSecond: Number((successful.length * 1000 / wallMs).toFixed(2)),
    aggregateOutputTokensPerSecond: Number((tokens * 1000 / wallMs).toFixed(2)),
  };
  console.log(JSON.stringify(summary));
  return { ...summary, requests };
}

const warmup = await translate(fixtures[0]);
if (warmup.status !== 200 || warmup.finishReason !== 'stop') throw new Error(`Warmup failed: ${JSON.stringify(warmup)}`);
const quality = [];
for (const fixture of fixtures) quality.push(await translate(fixture));
const suites = [];
for (const kind of kinds) {
  for (const concurrency of concurrencyLevels) suites.push(await run(kind, concurrency));
}
const report = {
  date: new Date().toISOString(),
  backend: process.env.BENCH_BACKEND ?? 'unspecified',
  machine: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), platform: platform(), arch: arch(), kernel: release() },
  model: process.env.BENCH_MODEL ?? 'Hy-MT2-1.8B-Q4_K_M',
  rounds, warmup, quality, suites,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Saved ${output}`);
if (quality.some(row => row.status !== 200 || row.finishReason !== 'stop') || suites.some(row => row.total !== row.completed)) process.exitCode = 1;
