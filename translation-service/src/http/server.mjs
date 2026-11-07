import { createServer } from 'node:http';

import { defaultModel, knownTargets, modelIds, models } from '../models/index.mjs';
import { InferenceError } from '../models/upstream.mjs';

const modelId = process.env.TRANSLATION_MODEL ?? models.get(defaultModel).id;
const model = modelIds.get(modelId);
if (!model) throw new Error(`Unknown translation model: ${modelId}`);
const inference = `http://127.0.0.1:${process.env.TRANSLATION_BACKEND_PORT ?? model.backendPort()}`;
const capabilities = { model: model.id, targets: model.targets, ...(model.sources && { sources: model.sources }) };
const port = Number(process.env.PORT ?? 18081);
const bodyLimit = 16 * 1024;

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let bytes = 0;
  let tooLarge = false;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > bodyLimit) tooLarge = true;
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) return { error: 'Request body exceeds 16 KiB', status: 413 };
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' && !Array.isArray(body)
      ? { body }
      : { error: 'Expected a JSON object', status: 400 };
  } catch {
    return { error: 'Invalid JSON', status: 400 };
  }
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    try {
      const upstream = await fetch(`${inference}/health`, { signal: AbortSignal.timeout(2000) });
      await upstream.body?.cancel();
      return respond(res, upstream.ok ? 200 : 503, { ready: upstream.ok, ...capabilities });
    } catch {
      return respond(res, 503, { ready: false, ...capabilities });
    }
  }
  if (req.method !== 'POST' || req.url !== '/v1/translate') {
    return respond(res, 404, { error: 'Use POST /v1/translate or GET /health' });
  }

  const parsed = await readJson(req).catch(() => ({ error: 'Cannot read request body', status: 400 }));
  if (parsed.error) return respond(res, parsed.status, { error: parsed.error });
  const { text, target = 'zh', source, expectedModel } = parsed.body;
  if (typeof text !== 'string' || !text.trim() || [...text].length > 1200) {
    return respond(res, 400, { error: 'text must contain 1 to 1200 characters' });
  }
  if (!knownTargets.has(target)) return respond(res, 400, { error: 'Unsupported target language' });
  if (expectedModel !== undefined && expectedModel !== model.id) return respond(res, 409, { error: '翻译模型已切换，请重试' });
  const pairError = model.pairError?.({ source, target });
  if (pairError) return respond(res, 400, { error: pairError });
  if (!model.targets.includes(target)) return respond(res, 400, { error: 'Unsupported target language' });

  const started = performance.now();
  const disconnected = new AbortController();
  res.on('close', () => disconnected.abort());
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(90_000), disconnected.signal]);
    const result = await model.translate(inference, { text: text.trim(), target, source }, signal);
    const translation = result.translation?.trim();
    if (!translation) return respond(res, 502, { error: 'Model returned no translation' });
    return respond(res, 200, {
      ...result, translation, target, model: model.id,
      latencyMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    if (disconnected.signal.aborted) return;
    if (error instanceof InferenceError) return respond(res, error.status, { error: error.message });
    return respond(res, error.name === 'TimeoutError' ? 504 : 503, { error: 'Inference unavailable or timed out' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Translation API: http://127.0.0.1:${port}`);
});
