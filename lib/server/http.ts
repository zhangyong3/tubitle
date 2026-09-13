import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  if (!origin.startsWith("chrome-extension://")) return {};
  const allowedIds = (process.env.ALLOWED_EXTENSION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const extensionId = origin.slice("chrome-extension://".length);
  if (allowedIds.length > 0 && !allowedIds.includes(extensionId)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
}

export function cors(request: Request): HeadersInit {
  return corsHeaders(request);
}

export function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

export function options(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function unauthorized(request: Request): NextResponse | undefined {
  const expected = process.env.PERSONAL_ACCESS_TOKEN?.trim();
  if (!expected) {
    return json(request, {
      error: "server_not_configured",
      message: "服务端尚未配置 PERSONAL_ACCESS_TOKEN"
    }, 503);
  }
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  const matches = actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes);
  if (!matches) return json(request, { error: "unauthorized", message: "个人访问令牌不正确" }, 401);
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64 * 1024) throw new RequestError("请求内容过大", 413);
  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new RequestError(`${name} 不能为空`);
  const result = value.trim();
  if (result.length > maximum) throw new RequestError(`${name} 不能超过 ${maximum} 个字符`);
  return result;
}

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function errorResponse(request: Request, error: unknown) {
  if (error instanceof RequestError) return json(request, { error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "服务端请求失败";
  console.error(error);
  return json(request, { error: "provider_error", message }, 502);
}
