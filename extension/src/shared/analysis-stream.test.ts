import { afterEach, describe, expect, it, vi } from "vitest";
import { streamSentenceAnalysis } from "./analysis-stream";

afterEach(() => vi.unstubAllGlobals());

describe("streaming sentence analysis", () => {
  it("forwards streamed deltas from the background worker", async () => {
    let messageListener: ((payload: { delta?: string; done?: boolean }) => void) | undefined;
    let posted: unknown;
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => ({
          postMessage(value: unknown) {
            posted = value;
            queueMicrotask(() => {
              messageListener?.({ delta: "翻译：你好" });
              messageListener?.({ delta: "\n结构：主谓宾" });
              messageListener?.({ done: true });
            });
          },
          disconnect: vi.fn(),
          onMessage: { addListener(listener: typeof messageListener) { messageListener = listener; } },
          onDisconnect: { addListener: vi.fn() }
        }))
      }
    });
    let received = "";
    await streamSentenceAnalysis("Hello.", (delta) => { received += delta; }, new AbortController().signal);
    expect(posted).toEqual({ sentence: "Hello." });
    expect(received).toBe("翻译：你好\n结构：主谓宾");
  });
});
