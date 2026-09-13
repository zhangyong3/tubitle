import { afterEach, describe, expect, it, vi } from "vitest";
import { streamSentenceAnalysis } from "./analysis-stream";

afterEach(() => vi.unstubAllGlobals());

describe("streaming sentence analysis", () => {
  it("reassembles SSE events split across network chunks", async () => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: vi.fn().mockResolvedValue({
        settings: {
          settingsVersion: 4,
          serverBaseUrl: "http://localhost:3000",
          serverAccessToken: "test-token"
        }
      }), set: vi.fn().mockResolvedValue(undefined) } }
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"delta":"翻'));
        controller.enqueue(encoder.encode('译：你好"}\n\ndata:\n\ndata: {"delta":"\\n结构：主谓宾"}\n\n'));
        controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })));
    let received = "";
    await streamSentenceAnalysis("Hello.", (delta) => { received += delta; }, new AbortController().signal);
    expect(received).toBe("翻译：你好\n结构：主谓宾");
  });
});
