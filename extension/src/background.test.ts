import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./shared/settings";
import { requestSubtitleTranslation } from "./shared/subtitle-translation";
import type { ExtensionMessage, MessageResponse } from "./shared/types";

const platform = vi.hoisted(() => ({ discover: vi.fn(), translate: vi.fn() }));

vi.mock("./learning-sync", () => ({
  getAccountTranslationSelection: platform.discover, requestAccountTranslation: platform.translate,
  syncStatus: async () => ({ connected: false, pending: 0 }), flushLearning: async () => undefined,
  enqueueLearning: async () => undefined, requestAccountAnalysis: vi.fn(), AnalysisAccessError: class extends Error {},
}));

vi.mock("./background-cache", () => ({
  getCachedTranslation: async () => undefined,
  cacheTranslation: async () => undefined
}));

const translated = () => Response.json([{ translations: [{ text: "译文" }] }]);
const throttled = (seconds: string) => Response.json({
  error: { code: 429001, message: "The server rejected the request because the client has exceeded request limits." }
}, { status: 429, headers: { "Retry-After": seconds } });

describe("subtitle translation from the extension background", () => {
  let send: (message: ExtensionMessage, sender?: unknown) => Promise<MessageResponse>;
  const request = vi.fn<typeof fetch>();
  let mode: "custom" | "tubitle";

  beforeEach(async () => {
    mode = "custom";
    vi.useFakeTimers();
    vi.resetModules();
    request.mockReset().mockImplementation(async () => translated());
    platform.discover.mockReset().mockResolvedValue({ userId: "alice", provider: "selfhosted", model: "test-model", revision: "a".repeat(64) });
    platform.translate.mockReset().mockImplementation(async (text, source, target, selection, signal) => {
      const response = await fetch("http://127.0.0.1:3100/api/extension/translation", { method: "POST", signal, body: JSON.stringify({ text, source, target, expectedRevision: selection.revision }) });
      return (await response.json()).translation;
    });
    vi.stubGlobal("fetch", request);
    let onConnect: (port: unknown) => void;
    vi.stubGlobal("chrome", {
      alarms: { create: async () => undefined, onAlarm: { addListener() {} } },
      runtime: {
        id: "qa-extension", getURL: (path: string) => `chrome-extension://qa-extension/${path}`,
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
        onMessage: {
          addListener: (handler: (message: ExtensionMessage, sender: unknown, reply: (response: MessageResponse) => void) => void) => {
            send = (message, sender = {}) => new Promise((resolve) => handler(message, sender, resolve));
          }
        },
        onConnect: { addListener: (handler: typeof onConnect) => { onConnect = handler; } },
        connect: ({ name }: { name: string }) => {
          let toBackground: (message: unknown) => void;
          let toContent: (message: unknown) => void;
          let onBackgroundDisconnect: () => void;
          onConnect({
            name,
            onMessage: { addListener: (handler: typeof toBackground) => { toBackground = handler; } },
            onDisconnect: { addListener: (handler: typeof onBackgroundDisconnect) => { onBackgroundDisconnect = handler; } },
            postMessage: (message: unknown) => toContent(message)
          });
          return {
            onMessage: { addListener: (handler: typeof toContent) => { toContent = handler; } },
            onDisconnect: { addListener() {} },
            postMessage: (message: unknown) => toBackground(message),
            disconnect: () => onBackgroundDisconnect()
          };
        }
      },
      storage: { onChanged: { addListener() {} }, local: { get: async () => ({ settings: { ...DEFAULT_SETTINGS, serviceMode: mode, provider: mode === "tubitle" ? "hy-mt-local" : "microsoft", microsoftTranslatorKey: "test-key" } }) } }
    });
    await import("./background");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const subtitle = (text: string, priority: "current" | "prefetch" = "prefetch") =>
    send({ type: "TRANSLATE", provider: "microsoft", text, sourceLanguage: "en", priority });

  it("restricts sync messages to internal pages", async () => {
    const contentSender = { id: "qa-extension", url: "https://www.youtube.com/watch?v=abcdefghijk" };
    expect(await send({ type: "LEARNING_SYNC_STATUS" }, contentSender)).toMatchObject({ ok: false });
    const internalSender = { id: "qa-extension", url: "chrome-extension://qa-extension/sidepanel.html" };
    expect(await send({ type: "LEARNING_SYNC_STATUS" }, internalSender)).toMatchObject({ ok: true, data: { connected: false, pending: 0 } });
    expect(request).not.toHaveBeenCalled();
  });

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

  it("cancels retries and queued subtitles when their caption session closes", async () => {
    request.mockResolvedValueOnce(throttled("2"));
    const session = new AbortController();
    const scoped = (text: string) => requestSubtitleTranslation({
      type: "TRANSLATE", provider: "microsoft", text, sourceLanguage: "en"
    }, session.signal).catch((error: unknown) => error);
    const first = scoped("Subtitle waiting for a retry.");
    const queued = scoped("Subtitle still in the queue.");
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    session.abort();
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(await queued).toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await subtitle("Another tab can still translate.")).toEqual({ ok: true, data: "译文" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reserves a platform request slot for the subtitle on screen while prefetching", async () => {
    const finish: Array<() => void> = [];
    request.mockImplementation(async (url) => String(url).endsWith("/health")
      ? Response.json({ ready: true, model: "hy-mt2-1.8b-q4" })
      : new Promise((resolve) => {
        finish.push(() => resolve(Response.json({ translation: "本机译文", finishReason: "stop" })));
      }));
    mode = "tubitle";
    const translations = () => request.mock.calls.filter(([url]) => String(url).endsWith("/api/extension/translation"));
    const local = (text: string, priority: "current" | "prefetch" = "prefetch") => send({
      type: "TRANSLATE", provider: "hy-mt-local", text, sourceLanguage: "en", priority
    });
    const pending = [local("First."), local("Second."), local("Third."), local("Fourth.")];
    await vi.advanceTimersByTimeAsync(0);
    expect(translations()).toHaveLength(3);
    const current = local("On screen now.", "current");
    await vi.advanceTimersByTimeAsync(0);
    expect(translations()).toHaveLength(4);
    expect(translations()[3]?.[0]).toBe("http://127.0.0.1:3100/api/extension/translation");
    expect(JSON.parse(String(translations()[3]?.[1]?.body))).toEqual({ text: "On screen now.", target: "zh", source: "en", expectedRevision: "a".repeat(64) });
    finish.slice().forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(translations()).toHaveLength(5);
    finish[4]!();
    await expect(Promise.all([...pending, current])).resolves.toEqual(Array(5).fill({ ok: true, data: "本机译文" }));
  });

  it("routes default-mode subtitles to Tubitle even when a caller passes Microsoft", async () => {
    mode = "tubitle";
    request.mockImplementation(async url => String(url).endsWith('/health')
      ? Response.json({ready: true, model: 'test-model'})
      : Response.json({translation: 'Tubitle 译文', finishReason: 'stop'}));
    expect(await subtitle('Use the configured service.')).toEqual({ok: true, data: 'Tubitle 译文'});
    expect(request.mock.calls.every(([url]) => String(url).endsWith("/api/extension/translation"))).toBe(true);
  });

  it("keeps subtitle caches separate when the platform selection or account changes", async () => {
    mode = "tubitle";
    let model = "hy-mt2-1.8b-q4";
    request.mockImplementation(async (url) => String(url).endsWith("/health")
      ? Response.json({ ready: true, model })
      : Response.json({ translation: model, finishReason: "stop" }));
    platform.discover.mockImplementation(async () => ({ userId: "alice", provider: "selfhosted", model, revision: model }));
    const local = () => send({ type: "TRANSLATE", provider: "hy-mt-local", text: "Same subtitle.", sourceLanguage: "en" });
    await expect(local()).resolves.toEqual({ ok: true, data: model });
    model = "opus-mt-en-zh-int8";
    await expect(local()).resolves.toEqual({ ok: true, data: model });
    model = "hy-mt2-1.8b-q4";
    await expect(local()).resolves.toEqual({ ok: true, data: model });
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/api/extension/translation"))).toHaveLength(2);
    platform.discover.mockResolvedValue({ userId: "bob", provider: "selfhosted", model, revision: model });
    await expect(local()).resolves.toEqual({ ok: true, data: model });
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/api/extension/translation"))).toHaveLength(3);
  });
});
