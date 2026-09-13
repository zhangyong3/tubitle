import { getSettings } from "./settings";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

function baseUrl(value: string): string {
  const result = value.trim().replace(/\/+$/, "");
  if (!result) throw new Error("请先在设置中填写服务地址");
  return result;
}

export async function readJsonResponse<T>(response: Response, label = "服务端"): Promise<T> {
  const value = await response.text();
  if (!value.trim()) {
    throw new ApiError("empty_response", `${label}返回了空响应，请稍后重试`, response.status);
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new ApiError("invalid_response", `${label}返回了无法识别的数据，请检查服务地址或代理配置`, response.status);
  }
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await getSettings();
  return fetch(`${baseUrl(settings.serverBaseUrl)}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(settings.serverAccessToken
        ? { Authorization: `Bearer ${settings.serverAccessToken}` }
        : {})
    }
  });
}
