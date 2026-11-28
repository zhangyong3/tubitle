// Dedicated D1 podcast worker. Same DB/bucket as the web app; no public fetch endpoint.
type QueueBinding = {
  send: (
    body: { id: string; action?: 'cleanup' },
    options?: { delaySeconds: number }
  ) => Promise<void>;
};
type Env = {
  DB: unknown;
  PODCAST_BUCKET: unknown;
  PODCAST_QUEUE: QueueBinding;
  DATABASE_PROVIDER: string;
  AUTH_SECRET: string;
  CONFIG_ENCRYPTION_KEY?: string;
};
async function initialize(env: Env) {
  (globalThis as any).__CF_ENV__ = env;
  process.env.DATABASE_PROVIDER = 'd1';
  process.env.AUTH_SECRET = env.AUTH_SECRET;
  if (env.CONFIG_ENCRYPTION_KEY)
    process.env.CONFIG_ENCRYPTION_KEY = env.CONFIG_ENCRYPTION_KEY;
  const { runWithDbScope } = await import('../core/db/request-scope');
  return runWithDbScope;
}
export default {
  async scheduled(_event: unknown, env: Env) {
    const scope = await initialize(env);
    await scope(async () => {
      const { getAllConfigs } = await import('../modules/config/service');
      const config = await getAllConfigs();
      const { cleanup } = await import('../server/podcasts/runner');
      const result = await cleanup(config, undefined, new Date(), (id) =>
        env.PODCAST_QUEUE.send({ id, action: 'cleanup' })
      );
      if (result.failed)
        console.error('Podcast cleanup has failed objects', result.failed);
      if (config.podcast_enabled !== 'true') return;
      const { schedule, pendingIds } =
        await import('../modules/podcasts/service');
      await schedule(100);
      // DB-first enqueue: pending tasks are re-discovered after a send failure or process crash.
      for (const row of await pendingIds(100))
        await env.PODCAST_QUEUE.send({ id: row.id });
    });
  },
  async queue(
    batch: {
      messages: {
        body: { id: string; action?: 'cleanup' };
        ack: () => void;
        retry: (options?: { delaySeconds: number }) => void;
      }[];
    },
    env: Env
  ) {
    const scope = await initialize(env);
    await scope(async () => {
      const { getAllConfigs } = await import('../modules/config/service');
      const config = await getAllConfigs();
      const { runEpisode, cleanupEpisode } =
        await import('../server/podcasts/runner');
      const { db } = await import('../core/db');
      const { eq } = await import('drizzle-orm');
      const { podcastEpisode } = await import('../config/db/schema');
      for (const message of batch.messages) {
        if (!message.body || !/^[-a-f0-9]{36}$/.test(message.body.id)) {
          message.ack();
          continue;
        }
        if (message.body.action === 'cleanup') {
          try {
            await cleanupEpisode(message.body.id, config);
            message.ack();
          } catch {
            message.retry({ delaySeconds: 60 });
          }
          continue;
        }
        if (config.podcast_enabled !== 'true') {
          message.ack();
          continue;
        }
        try {
          await runEpisode(message.body.id, config);
          const [row] = await db()
            .select({
              status: podcastEpisode.status,
              retryAt: podcastEpisode.retryAt,
            })
            .from(podcastEpisode)
            .where(eq(podcastEpisode.id, message.body.id));
          if (row?.status === 'queued' || row?.status === 'retry')
            await env.PODCAST_QUEUE.send(message.body, {
              delaySeconds: row.retryAt
                ? Math.max(
                    1,
                    Math.min(
                      900,
                      Math.ceil((row.retryAt.getTime() - Date.now()) / 1000)
                    )
                  )
                : 1,
            });
          message.ack();
        } catch {
          message.retry({ delaySeconds: 60 });
        }
      }
    });
  },
};
