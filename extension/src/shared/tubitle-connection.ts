import type { ExtensionSettings } from "./types";

export const LOCAL_TRANSLATION_ORIGIN = "http://127.0.0.1:18081";

export function tubitleConnection(settings: Pick<ExtensionSettings, "tubitleBaseUrl" | "tubitleApiKey">) {
  const url = new URL(settings.tubitleBaseUrl.trim() || LOCAL_TRANSLATION_ORIGIN);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new Error("Tubitle 服务地址只填写域名和端口，不包含路径或密钥");
  }
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("远程 Tubitle 服务必须使用 HTTPS");
  }
  const apiKey = settings.tubitleApiKey.trim();
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  return { origin: url.origin, headers };
}
