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
    assert.equal((await send(credential)).status, 503);
    assert.equal((await analysis.quota(credential.userId)).used, 0);
    fail = false;
    const requestId = crypto.randomUUID();
    const response = await send(credential, requestId);
    assert.equal(response.status, 200);
    assert.match((await response.json()).data.choices[0].message.content, /你好/);
    const before = calls;
    assert.equal((await send(credential, requestId)).status, 200);
    assert.equal(calls, before);
    assert.equal((await analysis.quota(credential.userId)).used, 1);
    const { getAuth } = await import('../src/core/auth');
    await getAuth().api.signOut({ headers: new Headers({cookie: credential.cookie}) });
    assert.equal((await send(credential)).status, 401);
    assert.equal(calls, before);
  } finally { globalThis.fetch = realFetch; }
});
