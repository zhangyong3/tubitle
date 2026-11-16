import { readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';

const base = process.env.BENCH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 18081}`;
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
const seconds = Number(process.env.BENCH_DURATION_SECONDS ?? 60);
if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(seconds) || seconds < 1) throw new Error('Invalid benchmark duration/concurrency');
const samples = JSON.parse(await readFile(new URL('./samples.json', import.meta.url), 'utf8')).filter(row => row.kind === 'subtitle' && row.target === 'zh');
const headers = { 'Content-Type': 'application/json', ...(process.env.BENCH_API_KEY && { Authorization: `Bearer ${process.env.BENCH_API_KEY}` }) };
const health = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(10000) });
if (!health.ok) throw new Error('Service is not ready');
const service = await health.json();

async function resources() {
  if (!process.env.BENCH_CGROUP) return null;
  const root = process.env.BENCH_CGROUP;
  const [cpu, memory] = await Promise.all([readFile(`${root}/cpu.stat`, 'utf8'), readFile(`${root}/memory.current`, 'utf8')]);
  return { timeMs: performance.now(), cpuUsec: Number(cpu.match(/^usage_usec (\d+)$/m)?.[1]), memoryBytes: Number(memory.trim()) };
}

const baseline = await resources();
const resourceSamples = [];
const timer = baseline ? setInterval(() => { void resources().then(row => resourceSamples.push(row)).catch(() => {}); }, 1000) : undefined;
let next = 0;
const requests = [];
const started = performance.now();
const deadline = started + seconds * 1000;
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const sample = samples[next++ % samples.length];
      const time = performance.now();
      try {
        const response = await fetch(`${base}/v1/translate`, {
          method: 'POST', headers,
          body: JSON.stringify({ text: sample.text, source: sample.source, target: sample.target, expectedModel: service.model }),
          signal: AbortSignal.timeout(95000),
        });
        const body = await response.json();
        requests.push({ id: sample.id, elapsedMs: Math.round(performance.now() - time), status: response.status, ...body });
      } catch (error) {
        requests.push({ id: sample.id, elapsedMs: Math.round(performance.now() - time), status: 0, error: error.message });
      }
    }
  }));
} finally {
  clearInterval(timer);
}
const wallMs = Math.round(performance.now() - started);
const finalResource = await resources();
const successful = requests.filter(row => row.status === 200 && row.finishReason === 'stop');
const latency = successful.map(row => row.elapsedMs).sort((a, b) => a - b);
const cpuPercent = baseline ? 100 * (finalResource.cpuUsec - baseline.cpuUsec) / ((finalResource.timeMs - baseline.timeMs) * 1000) : null;
const summary = {
  date: new Date().toISOString(), service, concurrency, plannedSeconds: seconds, wallMs,
  total: requests.length, completed: successful.length, errors: requests.length - successful.length,
  requestsPerSecond: Number((successful.length * 1000 / wallMs).toFixed(2)),
  p50Ms: latency[Math.ceil(latency.length * 0.5) - 1] ?? null,
  p95Ms: latency[Math.ceil(latency.length * 0.95) - 1] ?? null,
  serviceCpuPercent: cpuPercent === null ? null : Number(cpuPercent.toFixed(1)),
  serviceCpuCapacityPercent: cpuPercent === null ? null : Number((cpuPercent / cpus().length).toFixed(1)),
  maxSampledCgroupMemoryBytes: baseline ? Math.max(baseline.memoryBytes, finalResource.memoryBytes, ...resourceSamples.map(row => row.memoryBytes)) : null,
};
await writeFile(process.argv[2] ?? 'results/stress.json', JSON.stringify({ ...summary, requests, resourceSamples }, null, 2) + '\n');
console.log(JSON.stringify(summary));
if (summary.errors) process.exitCode = 1;
