import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'tubitle-translation-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${dir}/test.db`,
  AUTH_SECRET: 'isolated-translation-test-secret',
  CONFIG_ENCRYPTION_KEY: 'isolated-test-encryption-key',
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
const { discoverTranslation, translate } =
  await import('../src/core/translation');
const { validateTranslationConfig } =
  await import('../src/core/translation/config');
const {
  saveConfigs,
  getAllConfigs,
  getAdminConfigs,
  assertEndpointSecretsResupplied,
} = await import('../src/modules/config/service');
const { db } = await import('../src/core/db');
const { config: configTable } = await import('../src/config/db/schema');
const { eq } = await import('drizzle-orm');
const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});
const input = { text: 'Hello.', source: 'en-US', target: 'zh' };

test('validates credentials and secure endpoints', () => {
  const invalid: Record<string, string>[] = [
    { translation_provider: 'unknown' },
    { translation_provider: 'siliconflow' },
    {
      translation_provider: 'microsoft',
      translation_microsoft_api_key: 'key',
      translation_microsoft_endpoint: 'http://remote.example',
    },
    {
      translation_provider: 'selfhosted',
      translation_selfhosted_endpoint: 'https://user:key@example.test',
    },
  ];
  for (const values of invalid)
    assert.throws(() => validateTranslationConfig(values));
  validateTranslationConfig({ translation_provider: 'disabled' });
  validateTranslationConfig({
    translation_provider: 'selfhosted',
    translation_selfhosted_endpoint: 'http://127.0.0.1:18081',
  });
});

test('Microsoft maps languages and region and sanitizes errors', async () => {
  const config = {
    translation_provider: 'microsoft',
    translation_microsoft_api_key: 'ms-key',
    translation_microsoft_region: 'eastasia',
  };
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.get('to'), 'zh-Hant');
    assert.equal(new URL(String(url)).searchParams.get('from'), 'en');
    assert.equal(
      new Headers(init?.headers).get('Ocp-Apim-Subscription-Region'),
      'eastasia'
    );
    assert.equal(init?.redirect, 'error');
    return Response.json([{ translations: [{ text: '你好。' }] }]);
  };
  const selection = await discoverTranslation(config);
  assert.equal(
    (await translate(config, { ...input, target: 'zh-TW' }, selection))
      .translation,
    '你好。'
  );
  assert.equal(calls, 1);
  globalThis.fetch = async () =>
    new Response('private-upstream-diagnostic', {
      status: 429,
      headers: { 'retry-after': '12' },
    });
  await assert.rejects(
    translate(config, input, selection),
    (error) =>
      error instanceof Error &&
      !error.message.includes('private-upstream') &&
      (error as any).status === 429 &&
      (error as any).retryAfterMs === 12000
  );
});

test('SiliconFlow uses its own model, rejects truncation, and versions only active settings', async () => {
  const config = {
    translation_provider: 'siliconflow',
    translation_siliconflow_api_key: 'sf-key',
    translation_siliconflow_model: 'test-model',
  };
  const selection = await discoverTranslation(config);
  assert.equal(
    (
      await discoverTranslation({
        ...config,
        translation_microsoft_api_key: 'standby-key',
      })
    ).revision,
    selection.revision
  );
  assert.notEqual(
    (
      await discoverTranslation({
        ...config,
        translation_siliconflow_model: 'other-model',
      })
    ).revision,
    selection.revision
  );
  assert.notEqual(
    (
      await discoverTranslation({
        ...config,
        translation_siliconflow_api_key: 'rotated-key',
      })
    ).revision,
    selection.revision
  );
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, 'test-model');
    assert.match(payload.messages[0].content, /Simplified Chinese/);
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '你好。' } }],
    });
  };
  assert.equal(
    (await translate(config, input, selection)).translation,
    '你好。'
  );
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
    });
  await assert.rejects(translate(config, input, selection), /不完整/);
});

test('SiliconFlow enforces Traditional Chinese even when the model returns Simplified Chinese', async () => {
  const config = {
    translation_provider: 'siliconflow',
    translation_siliconflow_api_key: 'sf-key',
    translation_siliconflow_model: 'test-model',
  };
  const selection = await discoverTranslation(config);
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.match(payload.messages[0].content, /Traditional Chinese/);
    return Response.json({ choices: [{ finish_reason: 'stop', message: {
      content: '学习语言，让记忆与世界再次相逢。Language learning 123',
    } }] });
  };
  for (const target of ['zh-TW', 'zh-Hant']) {
    assert.equal((await translate(config, { ...input, target }, selection)).translation,
      '學習語言，讓記憶與世界再次相逢。Language learning 123');
  }
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
    content: '学习语言。',
  } }] });
  assert.equal((await translate(config, input, selection)).translation, '学习语言。');
  assert.equal((await translate(config, { ...input, target: 'ja' }, selection)).translation, '学习语言。');
});

test('Aliyun signs form data with ACS3 and rejects business failures', async () => {
  const config = {
    translation_provider: 'aliyun',
    translation_aliyun_access_key_id: 'test-id',
    translation_aliyun_access_key_secret: 'test-secret',
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://mt.cn-hangzhou.aliyuncs.com/');
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get('SourceLanguage'), 'en');
    assert.equal(form.get('Scene'), 'general');
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization')!;
    const signed = auth.match(/SignedHeaders=([^,]+)/)![1]!;
    const canonicalHeaders = signed
      .split(';')
      .map(
        (name) =>
          `${name}:${name === 'host' ? new URL(String(url)).host : headers.get(name)}\n`
      )
      .join('');
    const hash = (value: string) =>
      createHash('sha256').update(value).digest('hex');
    const bodyHash = hash(String(init?.body));
    assert.equal(headers.get('x-acs-content-sha256'), bodyHash);
    const canonical = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signed,
      bodyHash,
    ].join('\n');
    const signature = createHmac('sha256', 'test-secret')
      .update(`ACS3-HMAC-SHA256\n${hash(canonical)}`)
      .digest('hex');
    assert.equal(
      auth,
      `ACS3-HMAC-SHA256 Credential=test-id,SignedHeaders=${signed},Signature=${signature}`
    );
    return Response.json({ Code: '200', Data: { Translated: '你好。' } });
  };
  const selection = await discoverTranslation(config);
  assert.equal(
    (await translate(config, input, selection)).translation,
    '你好。'
  );
  globalThis.fetch = async () =>
    Response.json({ Code: 'UnsupportedLanguage', Message: 'private details' });
  await assert.rejects(
    translate(config, input, selection),
    /阿里云翻译请求失败/
  );
});

test('self-hosted model discovery and truncation checks preserve cache identity', async () => {
  const config = {
    translation_provider: 'selfhosted',
    translation_selfhosted_endpoint: 'https://self.example.test',
    translation_selfhosted_api_key: 'private-key',
  };
  let model = 'model-one';
  globalThis.fetch = async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer private-key'
    );
    if (String(url).endsWith('/health'))
      return Response.json({ ready: true, model });
    assert.equal(JSON.parse(String(init?.body)).expectedModel, model);
    return Response.json({
      translation: '你好。',
      model,
      finishReason: 'stop',
    });
  };
  const first = await discoverTranslation(config);
  assert.equal((await translate(config, input, first)).translation, '你好。');
  model = 'model-two';
  assert.notEqual((await discoverTranslation(config)).revision, first.revision);
  globalThis.fetch = async () =>
    Response.json({ translation: 'partial', finishReason: 'length' });
  await assert.rejects(translate(config, input, first), /截断/);
});

test('fresh configuration, encrypted/masked credentials and endpoint credential protection', async () => {
  await saveConfigs({
    translation_provider: 'microsoft',
    translation_microsoft_api_key: 'private-ms-key',
  });
  assert.match((await getAdminConfigs()).translation_microsoft_api_key!, /^••/);
  const [stored] = await db()
    .select()
    .from(configTable)
    .where(eq(configTable.name, 'translation_microsoft_api_key'));
  assert.match(stored.value, /^enc:v1:/);
  assert.equal(
    (await getAllConfigs(true)).translation_microsoft_api_key,
    'private-ms-key'
  );
  assert.throws(
    () =>
      assertEndpointSecretsResupplied(
        {
          translation_microsoft_endpoint: 'https://another.example.test',
          translation_microsoft_api_key: '••••••••-key',
        },
        { translation_microsoft_api_key: 'private-ms-key' }
      ),
    /re-entering/
  );
  await db()
    .update(configTable)
    .set({ value: 'disabled' })
    .where(eq(configTable.name, 'translation_provider'));
  assert.equal((await getAllConfigs(true)).translation_provider, 'disabled');
});

test('API authenticates accounts, rejects stale revisions and never falls back', async () => {
  const { handleExtensionTranslation } =
    await import('../src/server/translation/api');
  const { testLogin } = await import('./helpers/login');
  const login = await testLogin('translation');
  await saveConfigs({
    translation_provider: 'microsoft',
    translation_microsoft_api_key: 'api-key',
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json([{ translations: [{ text: '你好。' }] }]);
  };
  const send = (
    body?: unknown,
    account = login.userId,
    origin = `chrome-extension://${'a'.repeat(32)}`,
    cookie = login.cookie
  ) =>
    handleExtensionTranslation(
      new Request('http://localhost:3000/api/extension/translation', {
        method: body ? 'POST' : 'GET',
        headers: {
          origin,
          cookie,
          'content-type': 'application/json',
          'x-tubitle-extension': '1',
          'x-tubitle-account': account,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  assert.equal((await send(undefined, '', undefined, '')).status, 401);
  const discovery = await (await send()).json();
  assert.equal(discovery.data.userId, login.userId);
  assert.ok(!JSON.stringify(discovery).includes('api-key'));
  const body = { ...input, expectedRevision: discovery.data.revision };
  assert.equal((await send(body, 'other-account')).status, 401);
  assert.equal(
    (await send(body, login.userId, 'https://evil.example')).status,
    403
  );
  assert.equal((await send({ ...body, text: 'x'.repeat(1201) })).status, 400);
  assert.equal(
    (await send({ ...body, endpoint: 'https://evil.example' })).status,
    400
  );
  assert.equal(calls, 0);
  assert.equal((await send(body)).status, 200);
  assert.equal(calls, 1);
  await saveConfigs({ translation_microsoft_api_key: 'new-api-key' });
  assert.equal((await send(body)).status, 409);
  assert.equal(calls, 1);
  globalThis.fetch = async () => {
    calls++;
    return new Response('fail', { status: 503 });
  };
  const current = await (await send()).json();
  assert.equal(
    (await send({ ...body, expectedRevision: current.data.revision })).status,
    503
  );
  assert.equal(calls, 2);
  globalThis.fetch = async () =>
    new Response('private limit details', {
      status: 429,
      headers: { 'retry-after': '12' },
    });
  const limited = await send({
    ...body,
    expectedRevision: current.data.revision,
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '12');
  assert.ok(!(await limited.text()).includes('private limit details'));
});

test('daily subtitle quotas aggregate identities without request history, reset and reject invalid settings', async () => {
  const { consumeSubtitleQuota, subtitleIdentity, SubtitleQuotaError } =
    await import('../src/server/translation/quota');
  const { translationQuota } = await import('../src/config/db/schema');
  const request = (ip: string) =>
    new Request('http://localhost/api/extension/translation', {
      headers: { 'cf-connecting-ip': ip },
    });
  const now = new Date('2026-11-18T10:00:00Z');
  const id = subtitleIdentity(request('203.0.113.11'), '', '2026-11-18');
  assert.equal(id, subtitleIdentity(request('203.0.113.11'), '', '2026-11-18'));
  assert.notEqual(
    id,
    subtitleIdentity(request('203.0.113.11'), '', '2026-11-19')
  );
  assert.equal(
    subtitleIdentity(request('2001:db8::1'), '', '2026-11-18'),
    subtitleIdentity(request('2001:0db8:0:0:0:0:0:1'), '', '2026-11-18')
  );
  assert.throws(
    () => subtitleIdentity(request('invalid'), ''),
    SubtitleQuotaError
  );
  const config = {
    translation_guest_daily_limit: '100',
    translation_free_daily_limit: '7',
    translation_pro_daily_limit: '11',
  };
  const results = await Promise.allSettled(
    Array.from({ length: 110 }, () =>
      consumeSubtitleQuota(id, 'guest', config, now)
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 100);
  const failure = results.find((r) => r.status === 'rejected');
  assert.equal(
    failure?.status === 'rejected' && failure.reason.message,
    '今日匿名双语翻译额度已用完，请登录Tubitle开启更高额度'
  );
  const rows = await db()
    .select()
    .from(translationQuota)
    .where(eq(translationQuota.id, id));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['day', 'id', 'used']);
  assert.equal(rows[0].used, 100);
  for (const plan of ['free', 'pro'] as const) {
    const accountId = `test-${plan}`;
    for (let i = 0; i < 501; i++) await consumeSubtitleQuota(accountId, plan, config, now);
    assert.equal((await db().select().from(translationQuota).where(eq(translationQuota.id, accountId))).length, 0);
  }
  await consumeSubtitleQuota(
    'tomorrow',
    'guest',
    config,
    new Date('2026-11-19T00:00:00Z')
  );
  assert.equal(
    (
      await db()
        .select()
        .from(translationQuota)
        .where(eq(translationQuota.id, id))
    ).length,
    0
  );
  for (const value of ['-1', '1.2', 'abc', '1000001'])
    assert.throws(() =>
      validateTranslationConfig({
        translation_provider: 'disabled',
        translation_free_daily_limit: value,
      })
    );
});

test('anonymous translation API allows discovery, enforces IP quota and keeps account binding', async () => {
  const { handleExtensionTranslation } =
    await import('../src/server/translation/api');
  await saveConfigs({ translation_guest_daily_limit: '1' });
  globalThis.fetch = async () =>
    Response.json([{ translations: [{ text: '你好。' }] }]);
  const send = (body?: unknown) =>
    handleExtensionTranslation(
      new Request('http://localhost:3000/api/extension/translation', {
        method: body ? 'POST' : 'GET',
        headers: {
          origin: `chrome-extension://${'a'.repeat(32)}`,
          'cf-connecting-ip': '203.0.113.90',
          'x-tubitle-extension': '1',
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  const selection = await (await send()).json();
  assert.equal(selection.data.userId, '');
  const body = { ...input, expectedRevision: selection.data.revision };
  assert.equal((await send(body)).status, 200);
  const exhausted = await send(body);
  assert.equal(exhausted.status, 401);
  assert.equal(
    (await exhausted.json()).message,
    '今日匿名双语翻译额度已用完，请登录Tubitle开启更高额度'
  );
});

test('signed-in Free subtitles ignore legacy daily sentence caps', async () => {
  const { handleExtensionTranslation } =
    await import('../src/server/translation/api');
  const { testLogin } = await import('./helpers/login');
  const login = await testLogin('subtitle-free-quota');
  await saveConfigs({ translation_free_daily_limit: '1' });
  globalThis.fetch = async () =>
    Response.json([{ translations: [{ text: '你好。' }] }]);
  const send = (body?: unknown) =>
    handleExtensionTranslation(
      new Request('http://localhost:3000/api/extension/translation', {
        method: body ? 'POST' : 'GET',
        headers: {
          origin: `chrome-extension://${'a'.repeat(32)}`,
          cookie: login.cookie,
          'x-tubitle-extension': '1',
          'x-tubitle-account': login.userId,
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  const selection = await (await send()).json();
  const body = { ...input, expectedRevision: selection.data.revision };
  assert.equal((await send(body)).status, 200);
  assert.equal((await send(body)).status, 200);
  await saveConfigs({ translation_free_daily_limit: '2' });
  assert.equal((await send(body)).status, 200);
});
