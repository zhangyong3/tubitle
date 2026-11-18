import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_STATE_KEY, TUBITLE_SITE_URL } from './shared/learning-sync';
let stored: Record<string, unknown>;
let account: { userId: string; name: string } | undefined;
let offlineUpload: boolean;
const record = { clientRecordId: 'lookup-1', kind: 'word' as const, text: 'show', videoId: 'abcdefghijk', startSeconds: 14 };
const ok = (data: unknown = { saved: true }) => Response.json({ code: 0, data });
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetModules(); stored = {}; account = undefined; offlineUpload = false;
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => structuredClone(stored)),
    set: vi.fn(async value => { stored = { ...stored, ...structuredClone(value) }; }),
    remove: vi.fn(async key => { delete stored[key]; }),
  } } });
  request.mockReset().mockImplementation(async (_url, init) => {
    if (!account) return Response.json({ code: -1, data: { reason: 'LOGIN_REQUIRED' } }, { status: 401 });
    if (init?.method === 'GET') return ok(account);
    if ((init?.headers as Record<string, string>)['X-Tubitle-Account'] !== account.userId) return new Response('{}', {status: 401});
    if (offlineUpload) throw new Error('offline');
    return ok();
  });
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());
describe('automatic session sync', () => {
  it('keeps anonymous queries local and never backfills them after login', async () => {
    const sync = await import('./learning-sync');
    await sync.enqueueLearning(record);
    expect((await sync.syncStatus()).pending).toBe(0);
    account = { userId: 'alice', name: 'Alice' };
    await sync.flushLearning();
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('uploads after website login with cookies and a server-checked queue owner', async () => {
    account = { userId: 'alice', name: 'Alice' };
    const sync = await import('./learning-sync');
    await sync.enqueueLearning(record); await sync.flushLearning();
    const [, init] = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toMatchObject({ 'X-Tubitle-Account': 'alice', 'X-Tubitle-Extension': '1' });
    expect((await sync.syncStatus()).pending).toBe(0);
    expect(JSON.stringify(stored)).not.toContain('token');
  });
  it('preserves a failed upload across worker restarts and retries its stable key', async () => {
    account = { userId: 'alice', name: 'Alice' }; offlineUpload = true;
    let sync = await import('./learning-sync');
    await sync.enqueueLearning(record); await sync.flushLearning();
    expect((await sync.syncStatus()).pending).toBe(1);
    vi.resetModules(); sync = await import('./learning-sync'); offlineUpload = false;
    await sync.flushLearning();
    expect((await sync.syncStatus()).pending).toBe(0);
    const uploads = request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(uploads.every(([, init]) => JSON.parse(init!.body as string).clientRecordId === record.clientRecordId)).toBe(true);
  });
  it('stops on logout and discards the old account queue on account switch', async () => {
    account = { userId: 'alice', name: 'Alice' }; offlineUpload = true;
    const sync = await import('./learning-sync');
    await sync.enqueueLearning(record); await sync.flushLearning();
    expect((await sync.syncStatus()).pending).toBe(1);
    account = { userId: 'bob', name: 'Bob' }; offlineUpload = false;
    request.mockClear(); await sync.flushLearning();
    expect((stored[SYNC_STATE_KEY] as {queue: unknown[]}).queue).toEqual([]);
    account = undefined;
    expect(await sync.syncStatus()).toMatchObject({ connected: false, pending: 0 });
  });
  it('rejects an upload if the cookie account changes after validation', async () => {
    account = { userId: 'alice', name: 'Alice' };
    request.mockImplementation(async (_url, init) => init?.method === 'GET' ? ok(account) : new Response('{}', { status: 401 }));
    const sync = await import('./learning-sync');
    await sync.enqueueLearning(record); await sync.flushLearning();
    expect((stored[SYNC_STATE_KEY] as {queue: unknown[]}).queue).toEqual([]);
  });
  it('removes legacy manual credentials without uploading their old queue', async () => {
    stored.learningSyncState = { connection: { token: 'old-secret' }, queue: [record] };
    account = { userId: 'alice', name: 'Alice' };
    const sync = await import('./learning-sync');
    await sync.flushLearning();
    expect(stored.learningSyncState).toBeUndefined();
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('provides login and upgrade actions using the configured website', async () => {
    const sync = await import('./learning-sync');
    await expect(sync.requestAccountAnalysis('Hello.', crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ reason: 'LOGIN_REQUIRED', actionUrl: `${TUBITLE_SITE_URL}/zh/sign-in` });
    account = { userId: 'alice', name: 'Alice' };
    request.mockImplementation(async (_url, init) => init?.method === 'GET' ? ok(account) : Response.json({ code: -1, message: '额度已用完', data: { reason: 'QUOTA_EXHAUSTED' } }, { status: 403 }));
    await expect(sync.requestAccountAnalysis('Hello.', crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ reason: 'QUOTA_EXHAUSTED', actionUrl: `${TUBITLE_SITE_URL}/zh/pricing` });
  });
});


it('reports connection failure separately from a signed-out session and recovers', async () => {
  const sync = await import('./learning-sync');
  request.mockResolvedValueOnce(new Response('{}', { status: 403 }));
  expect(await sync.syncStatus()).toMatchObject({ connected: false, error: '暂时无法连接 Tubitle，请稍后重试' });
  expect(await sync.syncStatus()).toMatchObject({ connected: false, error: undefined });
  account = { userId: 'alice', name: 'Alice' };
  expect(await sync.syncStatus()).toMatchObject({ connected: true, error: undefined });
});

describe('account subtitle translation', () => {
  const selection = { userId: 'alice', provider: 'microsoft', model: 'Translator/v3.0', revision: 'a'.repeat(64) };
  it('retains platform rate-limit status and Retry-After for the prefetch scheduler', async () => {
    request.mockResolvedValue(Response.json({ code: -1, message: '翻译请求过于频繁' }, {status:429, headers:{'retry-after':'12'}}));
    const sync = await import('./learning-sync');
    await expect(sync.requestAccountTranslation('Hello', 'en', 'zh', selection)).rejects.toMatchObject({status:429, retryAfterMs:12000});
  });
  it('discovers fresh revisions, coalesces lookups and sends only account-bound requests', async () => {
    account = { userId: 'alice', name: 'Alice' };
    let revision = selection.revision;
    request.mockImplementation(async (url, init) => String(url).endsWith('/translation')
      ? ok(init?.method === 'GET' ? { ...selection, revision } : { translation: '你好', revision }) : ok(account));
    const sync = await import('./learning-sync');
    const [first, duplicate] = await Promise.all([sync.getAccountTranslationSelection(), sync.getAccountTranslationSelection()]);
    expect(first).toEqual(duplicate);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await sync.requestAccountTranslation('Hello', 'en', 'zh', first)).toBe('你好');
    const [, init] = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(init).toMatchObject({ credentials: 'include', redirect: 'error', headers: { 'X-Tubitle-Account': 'alice' } });
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Hello', source: 'en', target: 'zh', expectedRevision: first.revision });
    revision = 'b'.repeat(64);
    expect((await sync.getAccountTranslationSelection()).revision).toBe(revision);
    expect(JSON.stringify(init)).not.toContain('api_key');
  });
  it('rejects signed-out discovery and switched or invalid results without fallback', async () => {
    const sync = await import('./learning-sync');
    await expect(sync.getAccountTranslationSelection()).rejects.toThrow();
    request.mockResolvedValue(Response.json({ code: -1, message: '翻译配置已切换' }, { status: 409 }));
    await expect(sync.requestAccountTranslation('Hello', 'en', 'zh', selection)).rejects.toThrow('翻译配置已切换');
    request.mockResolvedValue(ok({ translation: 'old', revision: 'b'.repeat(64) }));
    await expect(sync.requestAccountTranslation('Hello', 'en', 'zh', selection)).rejects.toThrow('译文无效');
  });
  it('discards an in-flight translation if the cookie account changes', async () => {
    account = { userId: 'bob', name: 'Bob' };
    request.mockImplementation(async (_url, init) => init?.method === 'POST' ? ok({ translation: '你好', revision: selection.revision }) : ok(account));
    const sync = await import('./learning-sync');
    await expect(sync.requestAccountTranslation('Hello', 'en', 'zh', selection)).rejects.toThrow('账户已切换');
  });
});

describe('account analysis streaming', () => {
  it('returns a live body without waiting for generation to finish', async () => {
    account = { userId: 'alice', name: 'Alice' };
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const bytes = new TextEncoder();
    request.mockImplementation(async (_url, init) => init?.method === 'GET' ? ok(account) : new Response(new ReadableStream({ start(controller) {
      upstream = controller;
      controller.enqueue(bytes.encode('data: first\n\n'));
    } }), {headers:{'content-type':'text/event-stream'}}));
    const sync = await import('./learning-sync');
    const response = await sync.requestAccountAnalysis('Hello.', crypto.randomUUID(), new AbortController().signal);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('first');
    upstream.close();
    expect((await reader.read()).done).toBe(true);
  });
  it('refuses successful completion after an account switch', async () => {
    account = { userId: 'alice', name: 'Alice' };
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    request.mockImplementation(async (_url, init) => init?.method === 'GET' ? ok(account) : new Response(new ReadableStream({ start(controller) { upstream = controller; } }), {headers:{'content-type':'text/event-stream'}}));
    const sync = await import('./learning-sync');
    const response = await sync.requestAccountAnalysis('Hello.', crypto.randomUUID(), new AbortController().signal);
    account = { userId: 'bob', name: 'Bob' };
    upstream.close();
    await expect(response.text()).rejects.toThrow('账户已切换');
  });
});
