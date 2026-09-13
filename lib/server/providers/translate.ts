import { createHash, createHmac, randomUUID } from "node:crypto";

export type TranslationProvider = "microsoft" | "google" | "tencent";

export class ProviderError extends Error {}

async function providerJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    console.error(`${label} error ${response.status}: ${detail}`);
    throw new ProviderError(`${label}请求失败（${response.status}）`);
  }
  return response.json();
}

async function microsoft(texts: string[], source: string, target: string): Promise<string[]> {
  const key = process.env.MICROSOFT_TRANSLATOR_KEY;
  if (!key) throw new ProviderError("服务端尚未配置 Microsoft Translator");
  const endpoint = (process.env.MICROSOFT_TRANSLATOR_ENDPOINT
    ?? "https://api.cognitive.microsofttranslator.com").replace(/\/+$/, "");
  const url = new URL(`${endpoint}/translate`);
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("from", source);
  url.searchParams.set("to", target);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": key,
      "X-ClientTraceId": randomUUID(),
      ...(process.env.MICROSOFT_TRANSLATOR_REGION
        ? { "Ocp-Apim-Subscription-Region": process.env.MICROSOFT_TRANSLATOR_REGION }
        : {})
    },
    body: JSON.stringify(texts.map((text) => ({ text }))),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store"
  });
  const payload = await providerJson(response, "Microsoft 翻译") as Array<{
    translations?: Array<{ text?: string }>;
  }>;
  const results = payload.map((item) => item.translations?.[0]?.text ?? "");
  if (results.length !== texts.length || results.some((value) => !value)) {
    throw new ProviderError("Microsoft 翻译返回的数据不完整");
  }
  return results;
}

async function google(texts: string[], source: string, target: string): Promise<string[]> {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new ProviderError("服务端尚未配置 Google Cloud Translation");
  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", key);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: texts,
      source,
      target: target === "zh-Hans" ? "zh-CN" : target,
      format: "text"
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store"
  });
  const payload = await providerJson(response, "Google 翻译") as {
    data?: { translations?: Array<{ translatedText?: string }> };
  };
  const results = (payload.data?.translations ?? []).map((item) => decodeHtml(item.translatedText ?? ""));
  if (results.length !== texts.length || results.some((value) => !value)) {
    throw new ProviderError("Google 翻译返回的数据不完整");
  }
  return results;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

const tencentHost = "tmt.tencentcloudapi.com";
let lastTencentRequest = 0;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

async function tencentOne(value: string, source: string, target: string): Promise<string> {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) throw new ProviderError("服务端尚未配置腾讯云机器翻译");

  const wait = 260 - (Date.now() - lastTencentRequest);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastTencentRequest = Date.now();

  const body = JSON.stringify({
    SourceText: value,
    Source: source,
    Target: target === "zh-Hans" ? "zh" : target,
    ProjectId: 0
  });
  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10);
  const canonicalHeaders = "content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\nx-tc-action:texttranslate\n";
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const scope = `${date}/tmt/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const signingKey = hmac(hmac(hmac(`TC3${secretKey}`, date), "tmt"), "tc3_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const response = await fetch(`https://${tencentHost}`, {
    method: "POST",
    headers: {
      "Authorization": `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": "TextTranslate",
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": "2018-03-21",
      "X-TC-Region": process.env.TENCENT_REGION ?? "ap-guangzhou"
    },
    body,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store"
  });
  const payload = await providerJson(response, "腾讯翻译") as {
    Response?: { TargetText?: string; Error?: { Message?: string } };
  };
  if (payload.Response?.Error) throw new ProviderError(`腾讯翻译失败：${payload.Response.Error.Message ?? "未知错误"}`);
  if (!payload.Response?.TargetText) throw new ProviderError("腾讯翻译返回的数据不完整");
  return payload.Response.TargetText;
}

async function tencent(texts: string[], source: string, target: string): Promise<string[]> {
  const results: string[] = [];
  for (const value of texts) results.push(await tencentOne(value, source, target));
  return results;
}

export function translateBatch(
  provider: TranslationProvider,
  texts: string[],
  source: string,
  target: string
): Promise<string[]> {
  if (provider === "microsoft") return microsoft(texts, source, target);
  if (provider === "google") return google(texts, source, target);
  if (provider === "tencent") return tencent(texts, source, target);
  throw new ProviderError("不支持的翻译引擎");
}
