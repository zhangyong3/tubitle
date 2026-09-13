import { json, options } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return options(request);
}

export function GET(request: Request) {
  return json(request, {
    status: "ok",
    configured: {
      personalAccessToken: Boolean(process.env.PERSONAL_ACCESS_TOKEN),
      microsoft: Boolean(process.env.MICROSOFT_TRANSLATOR_KEY),
      google: Boolean(process.env.GOOGLE_TRANSLATE_API_KEY),
      tencent: Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY),
      llm: Boolean(process.env.LLM_API_KEY)
    }
  });
}
