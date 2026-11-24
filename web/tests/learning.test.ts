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
const { user } = await import('../src/config/db/schema');
const learning = await import('../src/modules/learning/service');
const { learningInput, videoLink } =
  await import('../src/lib/learning');
const { handleLearning } = await import('../src/routes/api/learning');
const { readLearningBody } = await import('../src/server/learning/api');
await db()
  .insert(user)
  .values([
    { id: 'alice', name: 'Alice', email: 'alice@example.test' },
    { id: 'bob', name: 'Bob', email: 'bob@example.test' },
  ]);
after(async () => {
  await rm(dir, { recursive: true, force: true });
});
const input = {
  kind: 'sentence' as const,
  text: 'Keep showing up.',
  videoId: 'abcdefghijk',
  startSeconds: 134,
};

test('accepts bounded records and rejects forged ownership and malformed positions', () => {
  assert.ok(learningInput.safeParse(input).success);
  for (const bad of [
    { ...input, userId: 'bob' },
    { ...input, videoId: 'https://evil.test' },
    { ...input, startSeconds: -1 },
    { ...input, startSeconds: 1.5 },
    { ...input, endSeconds: 100 },
    { ...input, text: ' ' },
    { ...input, text: 'x'.repeat(2001) },
  ])
    assert.equal(learningInput.safeParse(bad).success, false);
});
test('video links preserve the source position', () => {
  assert.equal(videoLink('abcdefghijk', 134), 'https://www.youtube.com/watch?v=abcdefghijk&t=134s');
});
test('concurrent duplicate saves create a single owned record', async () => {
  const rows = await Promise.all(
    Array.from({ length: 5 }, () =>
      learning.create('alice', { ...input, clientRecordId: 'same-request' })
    )
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, 1);
  assert.equal((await learning.list('alice')).total, 1);
});
test('another account cannot list, update, delete or export an owned record', async () => {
  const row = await learning.create('alice', {
    ...input,
    clientRecordId: 'private-record',
  });
  assert.equal((await learning.list('bob')).total, 0);
  assert.equal(await learning.updateStatus('bob', row.id, 'mastered'), null);
  await learning.remove('bob', row.id);
  assert.equal((await learning.exportRecords('bob')).length, 0);
  assert.ok(
    (await learning.exportRecords('alice')).some(
      (r: { id: string }) => r.id === row.id
    )
  );
});
test('search is literal; status and kind filters work; deleted records disappear', async () => {
  const row = await learning.create('alice', {
    ...input,
    kind: 'word',
    text: '100%_certain',
    clientRecordId: 'literal',
  });
  assert.equal((await learning.list('alice', { search: '%_' })).total, 1);
  await learning.updateStatus('alice', row.id, 'mastered');
  const filtered = await learning.list('alice', {
    kind: 'word',
    status: 'mastered',
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.summary.mastered, 1);
  await learning.remove('alice', row.id);
  assert.equal((await learning.list('alice', { search: '%_' })).total, 0);
  assert.ok(
    !(await learning.exportRecords('alice')).some(
      (r: { id: string }) => r.id === row.id
    )
  );
  await assert.rejects(() =>
    learning.create('alice', { ...input, clientRecordId: 'literal' })
  );
});
test('API refuses anonymous reads and cross-origin writes', async () => {
  assert.equal(
    (await handleLearning(new Request('http://localhost:3000/api/learning')))
      .status,
    401
  );
  assert.equal(
    (
      await handleLearning(
        new Request('http://localhost:3000/api/learning', {
          method: 'PATCH',
          headers: {
            origin: 'https://evil.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        })
      )
    ).status,
    403
  );
});
test('request reader rejects oversized and non-JSON bodies', async () => {
  await assert.rejects(
    () =>
      readLearningBody(
        new Request('http://localhost/api', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'x'.repeat(33000) }),
        })
      ),
    /too large/
  );
  await assert.rejects(
    () =>
      readLearningBody(
        new Request('http://localhost/api', {
          method: 'POST',
          body: 'not-json',
        })
      ),
    /Expected JSON/
  );
});

test('extension upload API authenticates account, persists analysis and acknowledges deleted retries', async () => {
  const { testLogin } = await import('./helpers/login');
  const { handleExtensionLearning } =
    await import('../src/routes/api/extension/learning');
  const login = await testLogin('upload');
  const request = (data: unknown, cookie = login.cookie) => {
    globalThis.__minIntervalRateLimitStore = new Map();
    return new Request('http://localhost:3000/api/extension/learning', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie, origin: 'chrome-extension://' + 'a'.repeat(32), 'x-tubitle-extension': '1', 'x-tubitle-account': login.userId,
      },
      body: JSON.stringify(data),
    });
  };
  const { handleExtensionLearning: handle } = await import('../src/routes/api/extension/learning');
  for (const patch of [ { origin: 'https://evil.test' }, { 'x-tubitle-extension': '' } ]) {
    const req = request({ ...input, clientRecordId: 'blocked' });
    const headers = new Headers(req.headers);
    for (const [key, value] of Object.entries(patch)) headers.set(key, value!);
    globalThis.__minIntervalRateLimitStore = new Map();
    assert.equal((await handle(new Request(req, {headers}))).status, 403);
  }
  const switched = request({ ...input, clientRecordId: 'wrong-account' });
  switched.headers.set('x-tubitle-account', 'another-account');
  assert.equal((await handle(switched)).status, 401);
  const data = {
    ...input,
    clientRecordId: 'extension-analysis',
    analysis: '结构分析\n' + '这是一个例句。'.repeat(2000),
  };
  assert.equal(
    (await handleExtensionLearning(request({ ...data, userId: 'alice' })))
      .status,
    400
  );
  assert.equal(
    (await handleExtensionLearning(request(data, 'invalid'))).status,
    401
  );
  assert.equal((await handleExtensionLearning(request(data))).status, 200);
  assert.equal((await handleExtensionLearning(request(data))).status, 200);
  const rows = (await learning.list(login.userId)).items.filter(
    (row: { clientRecordId: string }) =>
      row.clientRecordId === data.clientRecordId
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].analysis, data.analysis);
  assert.equal(
    (await learning.list('alice')).items.some(
      (row: { clientRecordId: string }) =>
        row.clientRecordId === data.clientRecordId
    ),
    false
  );
  await learning.remove(login.userId, rows[0].id);
  assert.equal((await handleExtensionLearning(request(data))).status, 200);
  assert.equal(
    (await learning.list(login.userId)).items.some(
      (row: { clientRecordId: string }) =>
        row.clientRecordId === data.clientRecordId
    ),
    false
  );
  assert.equal(
    (
      await handleExtensionLearning(
        request({
          ...data,
          clientRecordId: 'long',
          analysis: 'x'.repeat(50001),
        })
      )
    ).status,
    400
  );
  const { getAuth } = await import('../src/core/auth');
  await getAuth().api.signOut({ headers: new Headers({cookie: login.cookie}) });
  assert.equal((await handleExtensionLearning(request(data))).status, 401);
});

test('manual record creation is no longer available', async () => {
  assert.equal((await handleLearning(new Request('http://localhost:3000/api/learning', {method: 'POST'}))).status, 405);
});


test('extension account discovery accepts credentialed GET without Origin but still validates session and writes', async () => {
  const { testLogin } = await import('./helpers/login');
  const { authorizeExtension } = await import('../src/server/learning/extension-auth');
  const login = await testLogin('no-origin');
  const headers = { cookie: login.cookie, 'x-tubitle-extension': '1' };
  const url = 'http://localhost:3000/api/extension/learning';
  const access = await authorizeExtension(new Request(url, { headers }));
  assert.equal(access.response?.status, undefined);
  assert.equal(access.userId, login.userId);
  for (const extra of [{ origin: 'https://evil.test' }, { origin: 'null' }, { 'x-tubitle-extension': '' }] as Record<string, string>[]) {
    const denied = await authorizeExtension(new Request(url, { headers: { ...headers, ...extra } }));
    assert.equal(denied.response?.status, 403);
  }
  const anonymous = await authorizeExtension(new Request(url, { headers: { 'x-tubitle-extension': '1' } }));
  assert.equal(anonymous.response?.status, 401);
  const write = await authorizeExtension(new Request(url, { method: 'POST', headers }));
  assert.equal(write.response?.status, 403);
});


test('library can refresh four loaded pages in a burst and still limits sustained reads', async () => {
  const { testLogin } = await import('./helpers/login');
  const login = await testLogin('library-pagination');
  globalThis.__minIntervalRateLimitStore = new Map();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    for (let page = 1; page <= 4; page++) {
      const response = await handleLearning(new Request(`http://localhost:3000/api/learning?page=${page}`, {
        headers: { cookie: login.cookie },
      }));
      assert.equal(response.status, 200, `page ${page}: ${await response.text()}`);
    }
    let limited: Response | undefined;
    for (let page = 5; page <= 30; page++) {
      const response = await handleLearning(new Request(`http://localhost:3000/api/learning?page=${page}`, {
        headers: { cookie: login.cookie },
      }));
      if (response.status === 429) { limited = response; break; }
      assert.equal(response.status, 200);
    }
    assert.ok(limited, 'a sustained burst must still be rate limited');
    assert.equal(limited.headers.get('retry-after'), '1');
    now += 30;
    const recovered = await handleLearning(new Request('http://localhost:3000/api/learning?page=1', {
      headers: { cookie: login.cookie },
    }));
    assert.equal(recovered.status, 200, 'read capacity recovers after an interval');
  } finally {
    Date.now = realNow;
    globalThis.__minIntervalRateLimitStore = new Map();
  }
});
