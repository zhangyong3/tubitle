import { AwsClient } from 'aws4fetch';

import { isCloudflareWorker } from '@/core/db/runtime';

function safeKey(key: string) {
  if (!/^podcasts\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/\d{1,2}\.mp3$/.test(key))
    throw new Error('INVALID_AUDIO_KEY');
  return key;
}
function bucket(): any {
  return (globalThis as any).__CF_ENV__?.PODCAST_BUCKET;
}
export function localAudio(config: Record<string, string>) {
  return (
    !isCloudflareWorker &&
    process.env.NODE_ENV !== 'production' &&
    config.podcast_storage !== 'r2'
  );
}
async function localPath(key: string) {
  safeKey(key);
  const { resolve } = await import('node:path');
  return resolve(process.cwd(), 'data', key);
}
async function remote(
  key: string,
  config: Record<string, string>,
  method: string,
  body?: Uint8Array
) {
  safeKey(key);
  if (
    !/^[a-f0-9]{32}$/i.test(config.r2_account_id || '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.r2_bucket_name || '')
  )
    throw new Error('R2_CONFIG_INVALID');
  if (
    !config.r2_account_id ||
    !config.r2_access_key ||
    !config.r2_secret_key ||
    !config.r2_bucket_name
  )
    throw new Error('PRIVATE_STORAGE_NOT_CONFIGURED');
  const client = new AwsClient({
    accessKeyId: config.r2_access_key,
    secretAccessKey: config.r2_secret_key,
    region: 'auto',
  });
  // Fixed R2 endpoint. Never send a saved secret to an arbitrary URL.
  const url = `https://${config.r2_account_id}.r2.cloudflarestorage.com/${encodeURIComponent(config.r2_bucket_name)}/${key}`;
  const response = await client.fetch(url, {
    method,
    body: body as any,
    headers: { 'content-type': 'audio/mpeg' },
    redirect: 'error',
  });
  if (!response.ok && !(method === 'DELETE' && response.status === 404))
    throw new Error('AUDIO_STORAGE_FAILED');
  return response;
}
export async function writeAudio(
  key: string,
  data: Uint8Array,
  config: Record<string, string>
) {
  safeKey(key);
  if (bucket()) {
    await bucket().put(key, data, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
    return;
  }
  if (localAudio(config)) {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const path = await localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return;
  }
  await remote(key, config, 'PUT', data);
}
export async function readAudio(
  key: string,
  config: Record<string, string>
): Promise<Uint8Array> {
  safeKey(key);
  if (bucket()) {
    const obj = await bucket().get(key);
    if (!obj) throw new Error('AUDIO_NOT_FOUND');
    return new Uint8Array(await obj.arrayBuffer());
  }
  if (localAudio(config)) {
    const { readFile } = await import('node:fs/promises');
    return readFile(await localPath(key));
  }
  const response = await remote(key, config, 'GET');
  return new Uint8Array(await response.arrayBuffer());
}
// Deterministic episode prefixes remove checkpointed and orphaned segments alike.
export async function deleteEpisodeAudio(
  id: string,
  config: Record<string, string>
) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_EPISODE');
  if (localAudio(config)) {
    const { rm } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    await rm(resolve(process.cwd(), 'data', 'podcasts', id), {
      recursive: true,
      force: true,
    });
    return;
  }
  if (bucket()) {
    let cursor: string | undefined;
    do {
      const page = await bucket().list({ prefix: `podcasts/${id}/`, cursor });
      for (const obj of page.objects) await bucket().delete(obj.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return;
  }
  if (
    !/^[a-f0-9]{32}$/i.test(config.r2_account_id || '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.r2_bucket_name || '')
  )
    throw new Error('R2_CONFIG_INVALID');
  const client = new AwsClient({
    accessKeyId: config.r2_access_key,
    secretAccessKey: config.r2_secret_key,
    region: 'auto',
  });
  if (
    !config.r2_account_id ||
    !config.r2_bucket_name ||
    !config.r2_access_key ||
    !config.r2_secret_key
  )
    throw new Error('PRIVATE_STORAGE_NOT_CONFIGURED');
  const base = `https://${config.r2_account_id}.r2.cloudflarestorage.com/${encodeURIComponent(config.r2_bucket_name)}`;
  let token = '';
  do {
    const url = new URL(base);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', `podcasts/${id}/`);
    if (token) url.searchParams.set('continuation-token', token);
    const res = await client.fetch(url.toString(), { redirect: 'error' });
    if (!res.ok) throw new Error('AUDIO_CLEANUP_FAILED');
    const xml = await res.text();
    for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g))
      await remote(match[1], config, 'DELETE');
    token =
      xml.match(
        /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/
      )?.[1] || '';
  } while (token);
}
export async function sweepLocalOrphans(
  activeIds: Set<string>,
  now = new Date()
) {
  const { readdir, stat, rm } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const root = resolve(process.cwd(), 'data', 'podcasts');
  for (const dir of await readdir(root).catch(() => [])) {
    if (!/^[a-f0-9-]{36}$/.test(dir) || activeIds.has(dir)) continue;
    const path = resolve(root, dir);
    const info = await stat(path);
    if (now.getTime() - info.mtimeMs > 30 * 86400000)
      await rm(path, { recursive: true, force: true });
  }
}
