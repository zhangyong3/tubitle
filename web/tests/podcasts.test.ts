import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'tubitle-podcast-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${dir}/test.db`,
  NODE_ENV: 'test',
  AUTH_SECRET: 'isolated-podcast-test-not-a-real-secret',
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
const { eq, and } = await import('drizzle-orm');
const schema = await import('../src/config/db/schema');
const service = await import('../src/modules/podcasts/service');
const usage = await import('../src/modules/member-usage/service');
const runner = await import('../src/server/podcasts/runner');
const { validateScript, validateTeachingOrder, RETENTION_MS, usageDay } =
  await import('../src/lib/podcast');
const { ttsLanguage, mp3Duration } =
  await import('../src/server/podcasts/provider');
const { executeAdmin, findOperation } =
  await import('../src/server/admin/execute');
after(() => rm(dir, { recursive: true, force: true }));
async function seed(id: string, pro = false) {
  await db()
    .insert(schema.user)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      podcastLanguage: 'en',
    });
  if (pro)
    await db()
      .insert(schema.subscription)
      .values({
        id: `${id}-plan`,
        userId: id,
        subscriptionNo: `${id}-plan`,
        subscriptionId: `${id}-plan`,
        status: 'active',
        productId: 'tubitle-pro-monthly',
        paymentProvider: 'test',
        currentPeriodEnd: new Date(Date.now() + 86400000 * 60),
      });
  for (let i = 0; i < 5; i++)
    await db()
      .insert(schema.learningRecord)
      .values({
        id: `${id}-${i}`,
        userId: id,
        clientRecordId: `${id}-${i}`,
        kind: 'word',
        text: `単語${i}`,
        context: '日本語の学習',
        translation: 'word',
        note: '',
        videoId: 'abcdefghijk',
        videoTitle: 'test',
        startSeconds: i,
        sourceLanguage: 'ja',
        targetLanguage: 'zh',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
}
function providers(fail = false) {
  return {
    script: async (records: any[], source: string, target: string) => ({
      title: 'New situations',
      segments: Array.from({ length: 10 }, (_, i) => ({
        language: i % 2 ? source : target,
        sourceRecordIds: [records[i % 5].id],
        spokenText: 'A complete teaching segment.',
      })),
    }),
    speech: async () => {
      if (fail) throw new Error('TTS_PROVIDER_FAILED');
      return { audio: new Uint8Array([1, 2, 3]), durationMs: 25000 };
    },
    write: async () => {},
    remove: async () => {},
  };
}
async function complete(id: string) {
  for (let i = 0; i < 12; i++) await runner.runEpisode(id, {}, providers());
}
test('language support and script validation protect coverage, ownership and bytes', () => {
  assert.equal(ttsLanguage('ja'), 'ja-JP');
  assert.equal(ttsLanguage('zh-TW'), 'cmn-TW');
  assert.throws(() => ttsLanguage('xx'));
  const sources = [{ id: 'a' }];
  const raw = {
    title: 'Lesson',
    segments: Array.from({ length: 5 }, () => ({
      language: 'ja',
      sourceRecordIds: ['a'],
      spokenText: '例文',
    })),
  };
  assert.equal(validateScript(raw, sources, 'ja', 'en').segments.length, 5);
  assert.throws(() =>
    validateScript(
      {
        ...raw,
        segments: raw.segments.map((s) => ({
          ...s,
          sourceRecordIds: ['someone-else'],
        })),
      },
      sources,
      'ja',
      'en'
    )
  );
  assert.throws(() =>
    validateScript(
      { ...raw, segments: raw.segments.map((s) => ({ ...s, language: 'fr' })) },
      sources,
      'ja',
      'en'
    )
  );
  assert.throws(() => mp3Duration(new Uint8Array([1, 2, 3])));
});
test('concurrent free reservations produce one episode; success alone consumes trial; ownership enforced', async () => {
  await seed('trial');
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => service.createEpisode('trial'))
  );
  const rows = await service.listEpisodes('trial');
  assert.equal(rows.length, 1);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.equal((await service.preference('trial')).trialConsumedAt, null);
  assert.equal(await service.ownedEpisode('other', rows[0].id), null);
  const claims = await Promise.all(
    Array.from({ length: 4 }, () => service.claim(rows[0].id))
  );
  assert.equal(claims.filter(Boolean).length, 1);
  await service.checkpoint(rows[0].id, claims.find(Boolean).leaseToken, {
    status: 'queued',
  });
  await complete(rows[0].id);
  const ready = await service.ownedEpisode('trial', rows[0].id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.durationMs, 250000);
  assert.ok((await service.preference('trial')).trialConsumedAt);
  await assert.rejects(service.createEpisode('trial'), /TRIAL_USED/);
});
test('language changes affect new tasks only and dismissing the notice does not clear settings', async () => {
  await seed('language');
  const first = await service.createEpisode('language');
  await service.setPreference('language', { language: 'fr' });
  assert.equal(
    (await service.ownedEpisode('language', first.id)).translationLanguage,
    'en'
  );
  assert.equal((await service.preference('language')).language, 'fr');
  await service.setPreference('language', { dismissNotice: true });
  assert.equal((await service.preference('language')).language, 'fr');
});
test('failed segment is resumed without regenerating script or previous audio; trial not consumed', async () => {
  await seed('failure');
  const row = await service.createEpisode('failure');
  await runner.runEpisode(row.id, {}, providers());
  await runner.runEpisode(row.id, {}, providers(true));
  const failed = await service.ownedEpisode('failure', row.id);
  assert.equal(failed.status, 'retry');
  assert.ok(failed.script);
  assert.equal((await service.preference('failure')).trialConsumedAt, null);
  await db()
    .update(schema.podcastEpisode)
    .set({ retryAt: null })
    .where(eq(schema.podcastEpisode.id, row.id));
  await runner.runEpisode(row.id, {}, providers());
  assert.equal(
    JSON.parse((await service.ownedEpisode('failure', row.id)).manifest).length,
    1
  );
});
test('pro cancellation retains entitlement until paid end; 72-hour and fresh material rules apply', async () => {
  await seed('pro', true);
  await service.setPreference('pro', { enabled: true });
  await db()
    .update(schema.subscription)
    .set({ status: 'pending_cancel' })
    .where(eq(schema.subscription.userId, 'pro'));
  const row = await service.createEpisode('pro');
  await complete(row.id);
  assert.equal((await service.ownedEpisode('pro', row.id)).status, 'ready');
  await assert.rejects(service.createEpisode('pro'), /PODCAST_NOT_DUE/);
  await db()
    .update(schema.podcastPreference)
    .set({ nextDueAt: null })
    .where(eq(schema.podcastPreference.userId, 'pro'));
  await assert.rejects(service.createEpisode('pro'), /NOT_ENOUGH_MATERIAL/);
});
test('source deletion invalidates scripts immediately and late workers cannot republish', async () => {
  await seed('deleted');
  const row = await service.createEpisode('deleted');
  await runner.runEpisode(row.id, {}, providers());
  await service.invalidateForRecord('deleted', 'deleted-0');
  assert.equal(await service.ownedEpisode('deleted', row.id), null);
  await runner.runEpisode(row.id, {}, providers());
  assert.equal(await service.ownedEpisode('deleted', row.id), null);
});
test('usage is daily, monotonic across retries, capped by device count and rejects expired uploads', async () => {
  await seed('usage');
  const day = usageDay();
  const data = {
    clientId: crypto.randomUUID(),
    days: [{ day, sentences: 10, durationMs: 60000 }],
  };
  await Promise.all([
    usage.savePlayback('usage', data),
    usage.savePlayback('usage', data),
  ]);
  await usage.savePlayback('usage', {
    ...data,
    days: [{ day, sentences: 5, durationMs: 30000 }],
  });
  await usage.recordTranslation('usage');
  await usage.recordTranslation('usage');
  const result = await usage.usageFor('usage');
  assert.equal(result.days.length, 1);
  assert.equal(result.totals.playbackMs, 60000);
  assert.equal(result.totals.translations, 2);
  for (let i = 0; i < 9; i++)
    await usage.savePlayback('usage', {
      ...data,
      clientId: crypto.randomUUID(),
    });
  await assert.rejects(
    usage.savePlayback('usage', { ...data, clientId: crypto.randomUUID() }),
    /ACTIVITY_DEVICE_LIMIT/
  );
  await usage.savePlayback('usage', {
    ...data,
    days: [{ day: '2020-01-01', sentences: 100, durationMs: 9000 }],
  });
  assert.equal((await usage.usageFor('usage')).days.length, 1);
});
test('30-day expiry denies reads immediately; cleanup removes children and content but retains trial', async () => {
  await seed('expiry');
  const row = await service.createEpisode('expiry');
  await complete(row.id);
  const now = new Date();
  await db()
    .update(schema.podcastEpisode)
    .set({ expiresAt: now })
    .where(eq(schema.podcastEpisode.id, row.id));
  assert.equal(await service.ownedEpisode('expiry', row.id, now), null);
  await db()
    .insert(schema.memberUsageDay)
    .values({ id: 'old', userId: 'expiry', day: '2020-01-01', updatedAt: now });
  let removed = false;
  await runner.cleanup(
    { podcast_storage: 'local' },
    async (id) => {
      if (id === row.id) removed = true;
    },
    now
  );
  assert.ok(removed);
  assert.equal(
    (
      await db()
        .select()
        .from(schema.podcastEpisode)
        .where(eq(schema.podcastEpisode.id, row.id))
    ).length,
    0
  );
  assert.equal(
    (
      await db()
        .select()
        .from(schema.podcastSource)
        .where(eq(schema.podcastSource.episodeId, row.id))
    ).length,
    0
  );
  assert.ok((await service.preference('expiry')).trialConsumedAt);
});
test('cleanup failure scrubs script, retains only inaccessible retryable object references', async () => {
  await seed('cleanup-failure');
  const row = await service.createEpisode('cleanup-failure');
  await runner.runEpisode(row.id, {}, providers());
  await db()
    .update(schema.podcastEpisode)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.podcastEpisode.id, row.id));
  await runner.cleanup({ podcast_storage: 'local' }, async () => {
    throw new Error('storage down');
  });
  const [stored] = await db()
    .select()
    .from(schema.podcastEpisode)
    .where(eq(schema.podcastEpisode.id, row.id));
  assert.equal(stored.status, 'deleting');
  assert.equal(stored.script, null);
  assert.equal(await service.ownedEpisode('cleanup-failure', row.id), null);
});
test('admin usage and podcast content each require dedicated permissions', async () => {
  const actor = {
    userId: 'admin-test',
    permissions: ['admin.access', 'admin.users.read'],
  };
  await assert.rejects(
    executeAdmin(findOperation('users_usage'), { userId: 'trial' }, actor),
    /Forbidden/
  );
  await assert.rejects(
    executeAdmin(findOperation('users_podcasts'), { userId: 'trial' }, actor),
    /Forbidden/
  );
  const res = await executeAdmin(
    findOperation('users_podcasts'),
    { userId: 'trial' },
    { ...actor, permissions: ['admin.podcasts.read'] }
  );
  assert.equal(res.status, 200);
});

test('confirming legacy source language is owner-scoped and never relabels known records', async () => {
  await seed('legacy');
  await db()
    .update(schema.learningRecord)
    .set({ sourceLanguage: null })
    .where(eq(schema.learningRecord.id, 'legacy-0'));
  await service.confirmMaterialLanguage('other', ['legacy-0'], 'fr');
  assert.equal((await service.unknownMaterials('legacy')).length, 1);
  await service.confirmMaterialLanguage(
    'legacy',
    ['legacy-0', 'legacy-1'],
    'fr'
  );
  const [unknown] = await db()
    .select()
    .from(schema.learningRecord)
    .where(eq(schema.learningRecord.id, 'legacy-0'));
  const [known] = await db()
    .select()
    .from(schema.learningRecord)
    .where(eq(schema.learningRecord.id, 'legacy-1'));
  assert.equal(unknown.sourceLanguage, 'fr');
  assert.equal(known.sourceLanguage, 'ja');
});
test('playback retries do not double count and seeking to the end cannot mark an episode complete', async () => {
  await seed('progress');
  const row = await service.createEpisode('progress');
  await complete(row.id);
  const client = crypto.randomUUID();
  const start = new Date();
  await service.updateProgress(
    'progress',
    row.id,
    { client, sequence: 1, segment: 0, offset: 0, deltaMs: 0 },
    start
  );
  const later = new Date(start.getTime() + 15000);
  const body = {
    client,
    sequence: 2,
    segment: 0,
    offset: 15000,
    deltaMs: 15000,
  };
  await service.updateProgress('progress', row.id, body, later);
  await service.updateProgress('progress', row.id, body, later);
  assert.equal(
    (await service.ownedEpisode('progress', row.id)).listenedMs,
    15000
  );
  await service.updateProgress(
    'progress',
    row.id,
    { client, sequence: 3, segment: 9, offset: 25000, deltaMs: 15000 },
    new Date(later.getTime() + 15000)
  );
  assert.equal(
    (await service.ownedEpisode('progress', row.id)).completedAt,
    null
  );
  await assert.rejects(
    service.updateProgress('other', row.id, body),
    /NOT_FOUND/
  );
});
test('registration snapshots webpage language rather than Accept-Language, and it cannot be edited through auth profile', async () => {
  const { getAuth } = await import('../src/core/auth');
  const response = await getAuth().api.signUpEmail({
    body: {
      name: 'language-registration',
      email: 'registration-podcast@example.test',
      password: 'Isolated-qa-password-123!',
    },
    headers: new Headers({
      cookie: 'tubitle_registration_language=zh',
      'accept-language': 'ja-JP',
    }),
    asResponse: true,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const [account] = await db()
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, payload.user.id));
  assert.equal(account.podcastLanguage, 'zh');
  const cookie = response.headers
    .getSetCookie()
    .map((s: string) => s.split(';')[0])
    .join('; ');
  await assert.rejects(
    getAuth().api.updateUser({
      headers: new Headers({ cookie }),
      body: { podcastLanguage: 'fr' } as any,
    }),
    /not allowed/
  );
});

test('expired Pro tasks block without consuming a free experience and can resume after renewal', async () => {
  await seed('expired-pro', true);
  const row = await service.createEpisode('expired-pro');
  await db()
    .update(schema.subscription)
    .set({ currentPeriodEnd: new Date(0) })
    .where(eq(schema.subscription.userId, 'expired-pro'));
  await runner.runEpisode(row.id, {}, providers());
  assert.equal(
    (await service.ownedEpisode('expired-pro', row.id)).status,
    'blocked'
  );
  assert.equal((await service.preference('expired-pro')).trialConsumedAt, null);
  await db()
    .update(schema.subscription)
    .set({ currentPeriodEnd: new Date(Date.now() + 60 * 86400000) })
    .where(eq(schema.subscription.userId, 'expired-pro'));
  await service.retryEpisode('expired-pro', row.id);
  await complete(row.id);
  assert.equal(
    (await service.ownedEpisode('expired-pro', row.id)).status,
    'ready'
  );
  assert.equal((await service.preference('expired-pro')).trialConsumedAt, null);
});
test('deleting an unfinished episode cannot bypass the account creation interval', async () => {
  await seed('creation-limit');
  const row = await service.createEpisode('creation-limit');
  await service.markDeleting('creation-limit', row.id);
  await runner.cleanupEpisode(row.id, {}, async () => {});
  await assert.rejects(
    service.createEpisode('creation-limit'),
    /PODCAST_NOT_DUE/
  );
  assert.equal(
    (await service.preference('creation-limit')).trialConsumedAt,
    null
  );
});
test('audio supports authenticated range reads, expiration and private admin permission checks', async () => {
  const { audioResponse } = await import('../src/server/podcasts/api');
  const { writeAudio, deleteEpisodeAudio } =
    await import('../src/server/podcasts/storage');
  const { handleAdminPodcastAudio } =
    await import('../src/routes/api/admin/podcasts/$id/audio/$segment');
  const row = await service.ownedEpisode(
    'trial',
    (await service.listEpisodes('trial'))[0].id
  );
  const config = { podcast_storage: 'local' };
  const manifest = JSON.parse(row.manifest);
  await writeAudio(manifest[0].key, new Uint8Array([10, 20, 30, 40]), config);
  try {
    const range = await audioResponse(
      row,
      0,
      new Request('http://localhost:3000/audio', {
        headers: { range: 'bytes=1-2' },
      }),
      config
    );
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 1-2/4');
    assert.deepEqual([...new Uint8Array(await range.arrayBuffer())], [20, 30]);
    assert.equal(
      (
        await audioResponse(
          { ...row, expiresAt: new Date(0) },
          0,
          new Request('http://localhost:3000/audio'),
          config
        )
      ).status,
      404
    );
    const unauthorized = await handleAdminPodcastAudio(
      new Request('http://localhost:3000/admin/audio'),
      row.id,
      '0'
    );
    assert.equal(unauthorized.status, 401);
    const { testLogin } = await import('./helpers/login');
    const regular = await testLogin('no-private-podcast-permission');
    const forbidden = await handleAdminPodcastAudio(
      new Request('http://localhost:3000/admin/audio', {
        headers: { cookie: regular.cookie },
      }),
      row.id,
      '0'
    );
    assert.equal(forbidden.status, 403);
    assert.equal((await service.ownedEpisode('trial', row.id)).listenedMs, 0);
  } finally {
    await deleteEpisodeAudio(row.id, config);
  }
});
test('scheduled cleanup enqueues deletions while immediately scrubbing expired scripts', async () => {
  await seed('queued-cleanup');
  const row = await service.createEpisode('queued-cleanup');
  await runner.runEpisode(row.id, {}, providers());
  await db()
    .update(schema.podcastEpisode)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.podcastEpisode.id, row.id));
  const ids: string[] = [];
  await runner.cleanup(
    { podcast_storage: 'local' },
    undefined,
    new Date(),
    async (id) => {
      ids.push(id);
    }
  );
  assert.ok(ids.includes(row.id));
  assert.equal(await service.ownedEpisode('queued-cleanup', row.id), null);
  const [pending] = await db()
    .select()
    .from(schema.podcastEpisode)
    .where(eq(schema.podcastEpisode.id, row.id));
  assert.equal(pending.script, null);
  await runner.cleanupEpisode(row.id, {}, async () => {});
});

test('script provider uses the supported completion-token parameter', async () => {
  const { generateScript } = await import('../src/server/podcasts/provider');
  const originalFetch = globalThis.fetch;
  const sources = Array.from({ length: 5 }, (_, index) => ({
    id: `parameter-${index}`,
    kind: index === 4 ? 'sentence' : 'word',
    text: 'point',
    context: 'This is the original sentence containing the point.',
    analysis: 'saved analysis',
    translation: 'translation',
  }));
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_completion_tokens, 6500);
    assert.equal('max_tokens' in body, false);
    assert.equal('temperature' in body, false);
    const sent = JSON.parse(body.messages[1].content);
    assert.equal(sent[0].kind, 'word');
    assert.equal(sent[0].originalSentence, sources[0].context);
    assert.equal(sent[4].kind, 'sentence');
    assert.equal(sent[4].analysis, 'saved analysis');
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              title: 'Lesson',
              segments: sources.flatMap((row) =>
                Array.from({ length: 6 }, (_, i) => ({
                  language: i % 2 === 0 ? 'en' : 'zh',
                  sourceRecordIds: [row.id],
                  spokenText:
                    i === 0
                      ? row.kind === 'word'
                        ? row.context
                        : row.text
                      : 'A teaching segment.',
                }))
              ),
            }),
          },
        },
      ],
    });
  };
  try {
    assert.equal(
      (
        await generateScript(sources, 'en', 'zh', {
          openai_api_key: 'test-only-key',
          podcast_model: 'test-model',
          openai_base_url: 'https://api.example.test/v1',
        })
      ).segments.length,
      30
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('podcast scripts collect fragmented UTF-8 SSE and reject incomplete completions', async () => {
  const { readScriptCompletion } =
    await import('../src/server/podcasts/provider');
  const frames =
    'data: ' +
    JSON.stringify({
      choices: [{ delta: { content: '中文' }, finish_reason: null }],
    }) +
    '\r\n\r\ndata: ' +
    JSON.stringify({
      choices: [{ delta: { content: ' script' }, finish_reason: 'stop' }],
    }) +
    '\n\ndata: [DONE]\n\n';
  const encoded = new TextEncoder().encode(frames);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < encoded.length; i += 7)
        controller.enqueue(encoded.slice(i, i + 7));
      controller.close();
    },
  });
  assert.equal(
    await readScriptCompletion(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    ),
    '中文 script'
  );
  assert.equal(
    await readScriptCompletion(
      new Response(frames, { headers: { 'content-type': 'application/json' } })
    ),
    '中文 script'
  );
  await assert.rejects(
    readScriptCompletion(
      new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      )
    ),
    /SCRIPT_TRUNCATED/
  );
});

test('teaching order keeps each utterance and example with its immediate explanation', () => {
  const segments = Array.from({ length: 36 }, (_, i) => ({
    language: i % 2 === 0 ? 'ja' : 'fr',
    sourceRecordIds: [`point-${Math.floor(i / 6)}`],
    spokenText: 'Example or explanation',
  }));
  const raw = { title: 'Immediate explanation', segments };
  const sources = Array.from({ length: 6 }, (_, i) => ({ id: `point-${i}` }));
  const script = validateScript(raw, sources, 'ja', 'fr');
  assert.equal(validateTeachingOrder(script, 'ja', 'fr').segments.length, 36);
  assert.throws(
    () =>
      validateTeachingOrder(
        { ...script, segments: segments.slice(1) },
        'ja',
        'fr'
      ),
    /SCRIPT_TEACHING_ORDER/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        {
          ...script,
          segments: segments.map((s, i) =>
            i === 3 ? { ...s, language: 'ja' } : s
          ),
        },
        'ja',
        'fr'
      ),
    /SCRIPT_TEACHING_ORDER/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        {
          ...script,
          segments: segments.map((s, i) =>
            i === 3 ? { ...s, sourceRecordIds: ['point-1'] } : s
          ),
        },
        'ja',
        'fr'
      ),
    /SCRIPT_TEACHING_ORDER/
  );
});

test('record-specific teaching reads full word context and permits sentence phrase pairs', () => {
  const records = [
    {
      id: 'word',
      kind: 'word',
      text: 'stretch',
      context: 'We are in the final stretch of this project.',
    },
    {
      id: 'sentence',
      kind: 'sentence',
      text: 'She is ready to start.',
      context: '',
    },
  ];
  const segments = records.flatMap((r, index) =>
    Array.from({ length: 6 }, (_, i) => ({
      language: i % 2 === 0 ? 'en' : 'zh',
      sourceRecordIds: [r.id],
      spokenText:
        i === 0 ? r.context || r.text : 'Short example or explanation.',
    }))
  );
  const script = validateScript(
    { title: 'Words and sentences', segments },
    records,
    'en',
    'zh'
  );
  assert.equal(
    validateTeachingOrder(script, 'en', 'zh', records).segments.length,
    12
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        {
          ...script,
          segments: segments.map((s, i) =>
            i === 1 ? { ...s, spokenText: '简'.repeat(46) + '。' } : s
          ),
        },
        'en',
        'zh',
        records
      ),
    /SCRIPT_EXPLANATION_TOO_LONG/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        { ...script, segments: [...segments, ...segments.slice(-2)] },
        'en',
        'zh',
        records
      ),
    /SCRIPT_TEACHING_ORDER/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        {
          ...script,
          segments: segments.map((s, i) =>
            i === 1 ? { ...s, spokenText: '第一句。第二句。第三句。' } : s
          ),
        },
        'en',
        'zh',
        records
      ),
    /SCRIPT_EXPLANATION_TOO_LONG/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        {
          ...script,
          segments: segments.map((s, i) =>
            i === 0 ? { ...s, spokenText: 'stretch' } : s
          ),
        },
        'en',
        'zh',
        records
      ),
    /SCRIPT_ORIGINAL_SENTENCE/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        { ...script, segments: segments.filter((_, i) => i !== 4 && i !== 5) },
        'en',
        'zh',
        records
      ),
    /SCRIPT_TEACHING_ORDER/
  );
  assert.throws(
    () =>
      validateTeachingOrder(
        { ...script, segments: [...segments, ...segments.slice(0, 6)] },
        'en',
        'zh',
        records
      ),
    /SCRIPT_TEACHING_ORDER/
  );
});

test('concise complete episodes can publish without padding to four minutes', async () => {
  await seed('concise-episode');
  const row = await service.createEpisode('concise-episode');
  const short = {
    ...providers(),
    speech: async () => ({
      audio: new Uint8Array([1, 2, 3]),
      durationMs: 10000,
    }),
  };
  for (let i = 0; i < 12; i++) await runner.runEpisode(row.id, {}, short);
  const ready = await service.ownedEpisode('concise-episode', row.id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.durationMs, 100000);
});

test('whole-episode timeline maps global seeks and transcript jumps across boundaries', async () => {
  const { podcastTimeAt, podcastPositionAt, podcastClock } =
    await import('../src/lib/podcast-timeline');
  const parts = [
    { durationMs: 6000 },
    { durationMs: 14000 },
    { durationMs: 10000 },
  ];
  assert.equal(podcastTimeAt(parts, 1, 3500), 9500);
  assert.deepEqual(podcastPositionAt(parts, 6000), { index: 1, offsetMs: 0 });
  assert.deepEqual(podcastPositionAt(parts, 19500), {
    index: 1,
    offsetMs: 13500,
  });
  assert.deepEqual(podcastPositionAt(parts, 99999), {
    index: 2,
    offsetMs: 10000,
  });
  assert.deepEqual(podcastPositionAt(parts, -1), { index: 0, offsetMs: 0 });
  assert.deepEqual(podcastPositionAt([], 100), { index: 0, offsetMs: 0 });
  assert.equal(podcastClock(262776), '4:22');
  assert.equal(podcastClock(podcastTimeAt(parts, 2, 0)), '0:20');
});

test('speech verification rejects additions, omissions and repetitions, ignoring only punctuation', async () => {
  const { assertSpeechMatches } = await import('../src/lib/podcast-speech');
  assert.doesNotThrow(() =>
    assertSpeechMatches('这是“自由清单”。', '这是自由清单。')
  );
  assert.doesNotThrow(() =>
    assertSpeechMatches("We're ready!", 'we’re ready.')
  );
  assert.throws(
    () =>
      assertSpeechMatches('这是自由清单。', '这是自由清单。我再讲一个故事。'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
  assert.throws(
    () =>
      assertSpeechMatches('Read this once.', 'Read this once. Read this once.'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
  assert.throws(
    () => assertSpeechMatches('This is my freedom list.', 'This is my list.'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
});

test('synthesis returns audio only after an independent complete transcript matches', async () => {
  const { synthesize } = await import('../src/server/podcasts/provider');
  const originalFetch = globalThis.fetch;
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const privateKey = Buffer.from(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  ).toString('base64');
  const config = {
    podcast_google_credentials: JSON.stringify({
      project_id: 'test-project',
      client_email: 'test@example.test',
      private_key: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`,
    }),
  };
  const mp3 = new Uint8Array(417 * 5);
  for (let i = 0; i < 5; i++) mp3.set([255, 251, 144, 0], i * 417);
  let literal = false;
  let spoken = '这是自由清单。',
    finish = 'STOP',
    verificationStatus = 200;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('oauth2.googleapis.com'))
      return Response.json({ access_token: 'test-only-token' });
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('texttospeech.googleapis.com')) {
      assert.equal(body.voice.name, literal ? 'cmn-CN-Chirp3-HD-Puck' : 'Puck');
      assert.equal(body.input.text, '这是自由清单。');
      if (literal) assert.equal('prompt' in body.input, false);
      else assert.equal(body.input.prompt.includes('host'), false);
      return Response.json({
        audioContent: Buffer.from(mp3).toString('base64'),
      });
    }
    assert.equal(String(url).includes('speech.googleapis.com'), true);
    assert.equal(body.config.languageCode, 'cmn-Hans-CN');
    assert.equal(body.config.maxAlternatives, 5);
    assert.equal(body.config.encoding, 'MP3');
    assert.ok(body.audio.content);
    assert.equal(JSON.stringify(body).includes('这是自由清单'), false);
    if (verificationStatus !== 200)
      return new Response('', { status: verificationStatus });
    return Response.json({
      results:
        finish === 'STOP' ? [{ alternatives: [{ transcript: spoken }] }] : [],
    });
  };
  try {
    assert.ok(
      (await synthesize('这是自由清单。', 'zh', config)).durationMs > 100
    );
    literal = true;
    assert.ok(
      (await synthesize('这是自由清单。', 'zh', config, { literal: true }))
        .durationMs > 100
    );
    literal = false;
    spoken += '接下来我多说几句。';
    await assert.rejects(
      synthesize('这是自由清单。', 'zh', config),
      /TTS_TRANSCRIPT_MISMATCH/
    );
    spoken = '这是自由清单。';
    finish = 'EMPTY';
    await assert.rejects(
      synthesize('这是自由清单。', 'zh', config),
      /TTS_TRANSCRIPT_MISMATCH/
    );
    finish = 'STOP';
    verificationStatus = 429;
    await assert.rejects(
      synthesize('这是自由清单。', 'zh', config),
      /TTS_VERIFICATION_FAILED/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('speech comparison accepts independent ASR candidates and numeric formatting without tolerating extra speech', async () => {
  const { assertSpeechMatches } = await import('../src/lib/podcast-speech');
  assert.doesNotThrow(() =>
    assertSpeechMatches('I clock out at six.', 'I clock out at 6:00.')
  );
  assert.doesNotThrow(() =>
    assertSpeechMatches('通常六点下班。', '通常6点下班。')
  );
  assert.doesNotThrow(() =>
    assertSpeechMatches('a twenty-five minute walk', 'a 25 minute walk')
  );
  assert.doesNotThrow(() =>
    assertSpeechMatches('列出清单。', ['烈出清单', '列出清单'])
  );
  assert.throws(
    () =>
      assertSpeechMatches('列出清单。', ['烈出清单', '列出清单然后继续闲聊']),
    /TTS_TRANSCRIPT_MISMATCH/
  );
  assert.throws(
    () => assertSpeechMatches('at six', 'at seven'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
});

test('Mandarin homophone comparison preserves exact syllables and tones and never applies to Japanese', async () => {
  const { assertSpeechMatches } = await import('../src/lib/podcast-speech');
  assert.doesNotThrow(() =>
    assertSpeechMatches('借它表达意思', '借他表达意思', 'zh')
  );
  assert.doesNotThrow(() => assertSpeechMatches('列出清单', '烈出清单', 'zh'));
  assert.throws(
    () => assertSpeechMatches('这是自由清单', '这是自由清单啊', 'zh'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
  assert.throws(
    () => assertSpeechMatches('列出清单', '咧出清单', 'zh'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
  assert.throws(
    () => assertSpeechMatches('列出清单', '拿出清单', 'zh'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
  assert.throws(
    () => assertSpeechMatches('列出清单', '烈出清单', 'ja'),
    /TTS_TRANSCRIPT_MISMATCH/
  );
});
