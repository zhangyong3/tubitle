import { createHash } from "node:crypto";
import { errorResponse, json, readObject, RequestError, text, unauthorized } from "./http";
import { LruCache } from "./cache";
import { translateBatch, type TranslationProvider } from "./providers/translate";

const cache = new LruCache<string>(2000);
const providers = new Set<TranslationProvider>(["microsoft", "google", "tencent"]);

function key(provider: string, source: string, target: string, value: string) {
  return createHash("sha256").update([provider, source, target, value].join("\0")).digest("hex");
}

export async function handleTranslation(request: Request, batch: boolean) {
  const authError = unauthorized(request);
  if (authError) return authError;
  try {
    const body = await readObject(request);
    const source = text(body.from ?? "en", "from", 16);
    const target = text(body.to ?? "zh-Hans", "to", 16);
    const providerValue = text(body.provider, "provider", 20) as TranslationProvider;
    if (!providers.has(providerValue)) throw new RequestError("不支持的翻译引擎");

    const values = batch
      ? readTexts(body.texts)
      : [text(body.text, "text", 3000)];
    const results: Array<string | undefined> = new Array(values.length);
    const missing = new Map<string, string>();
    const indexes = new Map<string, number[]>();

    values.forEach((value, index) => {
      const cacheKey = key(providerValue, source, target, value);
      const cached = cache.get(cacheKey);
      if (cached !== undefined) results[index] = cached;
      else missing.set(cacheKey, value);
      indexes.set(cacheKey, [...(indexes.get(cacheKey) ?? []), index]);
    });

    if (missing.size > 0) {
      const entries = [...missing.entries()];
      const translations = await translateBatch(providerValue, entries.map(([, value]) => value), source, target);
      translations.forEach((translation, translatedIndex) => {
        const [cacheKey] = entries[translatedIndex]!;
        cache.set(cacheKey, translation);
        for (const index of indexes.get(cacheKey) ?? []) results[index] = translation;
      });
    }
    if (results.some((value) => value === undefined)) throw new Error("翻译服务缺少部分结果");
    return batch
      ? json(request, { translations: results })
      : json(request, { translation: results[0], cached: missing.size === 0 });
  } catch (error) {
    return errorResponse(request, error);
  }
}

function readTexts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 15) {
    throw new RequestError("texts 必须包含 1 到 15 条文本");
  }
  return value.map((item, index) => text(item, `texts[${index}]`, 3000));
}
