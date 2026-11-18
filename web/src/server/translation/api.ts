import { readLearningBody } from '@/server/learning/api';
import { authorizeExtension } from '@/server/learning/extension-auth';
import { z } from 'zod';

import {
  discoverTranslation,
  translate,
  TranslationError,
} from '@/core/translation';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respJson } from '@/lib/resp';

const language = z.string().regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/);
const input = z
  .object({
    text: z.string().trim().min(1).max(1200),
    source: language.optional(),
    target: language,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

// Permit the extension's concurrent prefetch burst. This is per-isolate traffic
// smoothing, not a distributed billing quota; enforce production limits at the edge.
const buckets = new Map<string, { tokens: number; at: number }>();
function rateLimited(userId: string, method: string) {
  const key = `${userId}:${method}`;
  const now = Date.now();
  const previous = buckets.get(key) ?? { tokens: 12, at: now };
  const tokens = Math.min(12, previous.tokens + (now - previous.at) / 200);
  if (buckets.size >= 10000 && !buckets.has(key))
    buckets.delete(buckets.keys().next().value!);
  buckets.set(key, { tokens: Math.max(0, tokens - 1), at: now });
  return tokens < 1;
}

export async function handleExtensionTranslation(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  try {
    const access = await authorizeExtension(request);
    if (access.response) return access.response;
    const parsed =
      request.method === 'GET'
        ? undefined
        : input.safeParse(await readLearningBody(request, 16384));
    if (parsed && !parsed.success)
      return respJson(-1, '翻译请求格式无效（最多 1200 字符）', undefined, {
        status: 400,
        headers,
      });
    if (rateLimited(access.userId, request.method))
      return respJson(-1, '翻译请求过于频繁，请稍后重试', undefined, {
        status: 429,
        headers: { ...headers, 'retry-after': '1' },
      });
    // No isolate cache: an administrator's saved selection applies to the next request.
    const config = await getAllConfigs(true);
    const upstreamSignal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(12000),
    ]);
    const selection = await discoverTranslation(config, upstreamSignal);
    if (!parsed)
      return respData({ ...selection, userId: access.userId }, { headers });
    if (!parsed.success) throw new Error('Invalid input');
    if (parsed.data.expectedRevision !== selection.revision)
      return respJson(
        -1,
        '翻译配置已切换，请重新请求',
        { reason: 'CONFIG_CHANGED' },
        { status: 409, headers }
      );
    return respData(
      await translate(config, parsed.data, selection, upstreamSignal),
      { headers }
    );
  } catch (error) {
    if (error instanceof TranslationError)
      return respJson(-1, error.message, undefined, {
        status: error.status,
        headers,
      });
    const invalid =
      error instanceof SyntaxError ||
      (error instanceof Error &&
        ['Expected JSON', 'Missing body', 'Body too large'].includes(
          error.message
        ));
    return respJson(
      -1,
      invalid ? '翻译请求格式无效' : '字幕翻译暂不可用，请联系管理员或稍后重试',
      undefined,
      { status: invalid ? 400 : 503, headers }
    );
  }
}
