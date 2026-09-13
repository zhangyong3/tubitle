import { cors, errorResponse, options, readObject, text, unauthorized } from "@/lib/server/http";
import { streamSentenceAnalysis } from "@/lib/server/providers/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS(request: Request) {
  return options(request);
}

export async function POST(request: Request) {
  const authError = unauthorized(request);
  if (authError) return authError;
  try {
    const body = await readObject(request);
    const sentence = text(body.sentence, "sentence", 3000);
    const stream = await streamSentenceAnalysis(sentence);
    return new Response(stream, {
      headers: {
        ...cors(request),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}
