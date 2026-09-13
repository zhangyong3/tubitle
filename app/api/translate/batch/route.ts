import { options } from "@/lib/server/http";
import { handleTranslation } from "@/lib/server/translation";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS(request: Request) {
  return options(request);
}

export function POST(request: Request) {
  return handleTranslation(request, true);
}
