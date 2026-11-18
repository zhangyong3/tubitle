import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'tubitle-learning-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${dir}/test.db`,
  AUTH_SECRET: 'isolated-learning-test-secret-not-a-real-credential',
  NODE_ENV: 'test',
  VITE_APP_URL: 'http://localhost:3000',
});
execFileSync(
  process.execPath,
  [
    'node_modules/drizzle-kit/bin.cjs',
    'push',
    '--dialect=sqlite',
    '--schema=./src/config/db/schema.sqlite.ts',
    `--url=${process.env.DATABASE_URL}`,
    '--force',
  ],
  { stdio: 'pipe', env: process.env }
);
const { db } = await import('../src/core/db');
const { user, subscription } = await import('../src/config/db/schema');
const analysis = await import('../src/modules/analysis/service');
const { analysisDay, analysisResetAt } = await import('../src/config/learning-plans');
await db().insert(user).values(['free', 'pro', 'expired', 'refund', 'reset'].map(id => ({ id, name: id, email: `${id}@example.test` })));
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('Beijing midnight defines the daily boundary', () => {
  assert.equal(analysisDay(new Date('2026-11-16T15:59:59Z')), '2026-11-16');
  assert.equal(analysisDay(new Date('2026-11-16T16:00:00Z')), '2026-11-17');
  assert.equal(analysisResetAt(new Date('2026-11-16T15:59:59Z')), '2026-11-16T16:00:00.000Z');
});
test('concurrent requests cannot exceed three free slots', async () => {
  const results = await Promise.allSettled(Array.from({length: 12}, (_, i) => analysis.reserve('free', `req-${i}`, 'Hello.')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.equal((await analysis.quota('free')).remaining, 0);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.status === 'rejected' && r.reason.code === 'QUOTA_EXHAUSTED'));
});
test('completed retries are cached and failures release their slot once', async () => {
  const first = await analysis.reserve('refund', 'first', 'Hello.');
  await analysis.complete('refund', first.id, '翻译：你好');
  assert.equal((await analysis.reserve('refund', 'first', 'Hello.')).result, '翻译：你好');
  await assert.rejects(analysis.reserve('refund', 'first', 'Other.'), { code: 'REQUEST_MISMATCH' });
  const second = await analysis.reserve('refund', 'second', 'Hi.');
  await assert.rejects(analysis.reserve('refund', 'second', 'Hi.'), { code: 'ANALYSIS_IN_PROGRESS' });
  await Promise.all([analysis.refund('refund', second.id), analysis.refund('refund', second.id)]);
  assert.equal((await analysis.quota('refund')).used, 1);
  await analysis.refund('refund', first.id);
  assert.equal((await analysis.quota('refund')).used, 1);
});
test('only an active recognized Pro subscription grants 100 uses', async () => {
  const now = new Date();
  await db().insert(subscription).values(['pro', 'expired'].map(id => ({ id, userId: id, subscriptionNo: id, subscriptionId: id, paymentProvider: 'test', status: 'active', productId: 'tubitle-pro-monthly', currentPeriodEnd: new Date(now.getTime() + (id === 'pro' ? 86400000 : -86400000)) })));
  assert.equal((await analysis.quota('pro')).limit, 100);
  assert.equal((await analysis.quota('expired')).limit, 3);
  const results = await Promise.allSettled(Array.from({length: 101}, (_, i) => analysis.reserve('pro', `pro-${i}`, 'Hello.')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 100);
});
test('previous day usage does not reduce the next day quota', async () => {
  await analysis.reserve('reset', 'old', 'Hello.', new Date('2026-11-16T15:59:59Z'));
  assert.equal((await analysis.quota('reset', new Date('2026-11-16T16:00:00Z'))).remaining, 3);
});

test('API requires login, blocks exhausted accounts, refunds provider failures and caches success', async () => {
  const { handleExtensionAnalysis } = await import('../src/routes/api/extension/analysis');
  const { testLogin } = await import('./helpers/login');
  const { saveConfigs } = await import('../src/modules/config/service');
  await db().insert(user).values({ id: 'api', name: 'API QA', email: 'api@example.test' });
  const credential = await testLogin('analysis');
  const exhausted = await testLogin('exhausted');
  await Promise.all(Array.from({length:3}, (_,i) => analysis.reserve(exhausted.userId, `exhausted-${i}`, 'Hello.')));
  const realFetch = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = async () => {
    calls++;
    return fail ? new Response('Unavailable', { status: 503 }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: '翻译：你好\n结构：问候语' } }] });
  };
  const send = (login?: {cookie: string; userId: string}, requestId = crypto.randomUUID(), extra = {}) => {
    globalThis.__minIntervalRateLimitStore?.clear();
    return handleExtensionAnalysis(new Request('http://localhost:3000/api/extension/analysis', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://' + 'a'.repeat(32), 'x-tubitle-extension': '1', ...(login ? { cookie: login.cookie, 'x-tubitle-account': login.userId } : {}) },
      body: JSON.stringify({ sentence: 'Hello.', requestId, ...extra }),
    }));
  };
  try {
    assert.equal((await send()).status, 401);
    assert.equal(calls, 0);
    const denied = await send(exhausted);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).data.reason, 'QUOTA_EXHAUSTED');
    assert.equal(calls, 0);
    assert.equal((await send(credential, crypto.randomUUID(), { plan: 'pro' })).status, 400);
    await saveConfigs({ openai_base_url: 'https://ai.example.test/v1', openai_api_key: 'test-only-key', openai_model: 'test-model' });
    fail = true;
    const failed = await send(credential);
    assert.match(await failed.text(), /未完整完成/);
    assert.equal((await analysis.quota(credential.userId)).used, 0);
    fail = false;
    const requestId = crypto.randomUUID();
    const response = await send(credential, requestId);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /你好/);
    const before = calls;
    const cached = await send(credential, requestId);
    assert.equal(cached.status, 200);
    assert.match(await cached.text(), /你好/);
    assert.equal(calls, before);
    assert.equal((await analysis.quota(credential.userId)).used, 1);
    const { getAuth } = await import('../src/core/auth');
    await getAuth().api.signOut({ headers: new Headers({cookie: credential.cookie}) });
    assert.equal((await send(credential)).status, 401);
    assert.equal(calls, before);
  } finally { globalThis.fetch = realFetch; }
});

test('API streams the first delta before generation finishes', async () => {
  const { handleExtensionAnalysis } = await import('../src/routes/api/extension/analysis');
  const { testLogin } = await import('./helpers/login');
  const { saveConfigs } = await import('../src/modules/config/service');
  const credential = await testLogin('streaming');
  await saveConfigs({ openai_base_url: 'https://ai.example.test/v1', openai_api_key: 'test-only-key', openai_model: 'test-model' });
  const realFetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  let started!: () => void;
  const upstreamStarted = new Promise<void>(resolve => started = resolve);
  let streaming: unknown;
  globalThis.fetch = async (_url, init) => {
    streaming = JSON.parse(String(init?.body)).stream;
    return new Response(new ReadableStream({ async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"翻译：你好"}}]}\r\n\r\n'));
      started();
      await gate;
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  globalThis.__minIntervalRateLimitStore?.clear();
  const pending = handleExtensionAnalysis(new Request('http://localhost:3000/api/extension/analysis', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://' + 'a'.repeat(32), 'x-tubitle-extension': '1', cookie: credential.cookie, 'x-tubitle-account': credential.userId },
    body: JSON.stringify({ sentence: 'Hello.', requestId: crypto.randomUUID() }),
  }));
  try {
    await upstreamStarted;
    const earlyResponse = await Promise.race([pending, new Promise<undefined>(resolve => setTimeout(resolve, 150))]);
    assert.ok(earlyResponse, 'gateway must respond before the provider finishes');
    assert.equal(streaming, true);
    assert.match(earlyResponse.headers.get('content-type')!, /text\/event-stream/);
    const reader = earlyResponse.body!.getReader();
    const first = await Promise.race([reader.read(), new Promise<undefined>(resolve => setTimeout(resolve, 150))]);
    assert.ok(first, 'first delta must arrive before completion');
    assert.match(new TextDecoder().decode(first.value), /你好/);
    release();
    let rest = '';
    while (true) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
    assert.match(rest, /\[DONE\]/);
    assert.equal((await analysis.quota(credential.userId)).used, 1);
  } finally { release(); await pending; globalThis.fetch = realFetch; }
});

test('stream failures, truncation and client cancellation refund once and never cache partial analysis', async () => {
  const { handleExtensionAnalysis } = await import('../src/routes/api/extension/analysis');
  const { testLogin } = await import('./helpers/login');
  const { saveConfigs } = await import('../src/modules/config/service');
  await saveConfigs({ openai_base_url: 'https://ai.example.test/v1', openai_api_key: 'test-only-key', openai_model: 'test-model' });
  const credential = await testLogin('stream-failure');
  const realFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  try {
    for (const mode of ['truncated', 'provider-error', 'cancel']) {
      let cancelled = false;
      globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          if (mode === 'truncated') { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')); controller.close(); }
          if (mode === 'provider-error') { controller.enqueue(encoder.encode('data: {"error":{"message":"private vendor detail"}}\n\n')); controller.close(); }
        },
        cancel() { cancelled = true; },
      }), { headers: { 'content-type': 'text/event-stream' } });
      globalThis.__minIntervalRateLimitStore?.clear();
      const requestId = crypto.randomUUID();
      const response = await handleExtensionAnalysis(new Request('http://localhost:3000/api/extension/analysis', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://' + 'a'.repeat(32), 'x-tubitle-extension': '1', cookie: credential.cookie, 'x-tubitle-account': credential.userId },
        body: JSON.stringify({ sentence: 'Hello.', requestId }),
      }));
      if (mode === 'cancel') {
        const reader = response.body!.getReader();
        assert.match(new TextDecoder().decode((await reader.read()).value), /partial/);
        await reader.cancel();
        for (let attempt = 0; attempt < 50 && (await analysis.quota(credential.userId)).used; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(cancelled, true);
      } else {
        const text = await response.text();
        assert.match(text, /partial/);
        assert.match(text, /未扣除额度/);
        assert.doesNotMatch(text, /\[DONE\]|private vendor detail/);
      }
      assert.equal((await analysis.quota(credential.userId)).used, 0);
      await assert.rejects(analysis.reserve(credential.userId, requestId, 'Hello.'), { code: 'REQUEST_FAILED' });
    }
  } finally { globalThis.fetch = realFetch; }
});
