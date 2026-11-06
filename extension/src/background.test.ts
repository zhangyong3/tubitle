import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./shared/settings";
import type { ExtensionMessage, MessageResponse } from "./shared/types";

vi.mock("./background-cache", () => ({
  getCachedTranslation: async () => undefined,
  cacheTranslation: async () => undefined
}));

const translated = () => Response.json([{ translations: [{ text: "译文" }] }]);
const throttled = (seconds: string) => Response.json({
  error: { code: 429001, message: "The server rejected the request because the client has exceeded request limits." }
}, { status: 429, headers: { "Retry-After": seconds } });

describe("Microsoft Translator from the extension background", () => {
  let send: (message: ExtensionMessage) => Promise<MessageResponse>;
  const request = vi.fn<typeof fetch>();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    request.mockReset().mockImplementation(async () => translated());
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: (handler: (message: ExtensionMessage, sender: unknown, reply: (response: MessageResponse) => void) => void) => {
            send = (message) => new Promise((resolve) => handler(message, {}, resolve));
          }
        },
        onConnect: { addListener: vi.fn() }
      },
      storage: { local: { get: async () => ({ settings: { ...DEFAULT_SETTINGS, microsoftTranslatorKey: "test-key" } }) } }
    });
    await import("./background");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const subtitle = (text: string, priority: "current" | "prefetch" = "prefetch") =>
    send({ type: "TRANSLATE", provider: "microsoft", text, sourceLanguage: "en", priority });

  it("recovers a subtitle after a 429001 and pauses other tabs and connection tests during Retry-After", async () => {
    request.mockResolvedValueOnce(throttled("2"));
    const first = subtitle("The subtitle that hit the rate limit.", "current");
    await vi.advanceTimersByTimeAsync(0);
    const prefetch = subtitle("A subtitle queued from another tab.");
    const test = send({ type: "TEST_PROVIDER", provider: "microsoft" });

    await vi.advanceTimersByTimeAsync(1999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ ok: true, data: "译文" });
    await vi.runAllTimersAsync();
    expect(await test).toEqual({ ok: true, data: null });
    expect(await prefetch).toEqual({ ok: true, data: "译文" });
    expect(request.mock.calls.map(([, options]) => JSON.parse(String(options?.body))[0].text)).toEqual([
      "The subtitle that hit the rate limit.",
      "The subtitle that hit the rate limit.",
      "This is a connection test.",
      "A subtitle queued from another tab."
    ]);
  });

  it("does not retry exhaustion of the F0 allowance", async () => {
    request.mockResolvedValueOnce(Response.json({ error: { code: 403001 } }, { status: 403 }));
    const result = subtitle("A subtitle after the monthly limit.");
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining("403001") });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("spaces a burst by the number of characters sent", async () => {
    const first = subtitle("This is a longer subtitle. ".repeat(16));
    const second = subtitle("A queued subtitle.");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await Promise.all([first, second])).toEqual([
      { ok: true, data: "译文" }, { ok: true, data: "译文" }
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not keep sending queued subtitles when Azure asks for a long cooldown", async () => {
    request.mockResolvedValueOnce(throttled("60"));
    const first = subtitle("A subtitle that must wait.");
    const second = subtitle("A subtitle behind it.");
    await vi.runAllTimersAsync();
    for (const result of await Promise.all([first, second])) {
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("请稍后重试") });
    }
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await subtitle("A subtitle after the cooldown.")).toEqual({ ok: true, data: "译文" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
