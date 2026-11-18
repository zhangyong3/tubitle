import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("does not reload tracks when only the timestamp or other watch URL parameters change", async () => {
  vi.resetModules();
  const document = Object.assign(new EventTarget(), { getElementById: () => null });
  const location = new URL("https://www.youtube.com/watch?v=current&t=1223s");
  const track = { baseUrl: "https://www.youtube.com/api/timedtext?lang=en", languageCode: "en" };
  let poll!: () => void;
  const publish = vi.fn();
  document.addEventListener("tubetitle:tracks", publish);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", {
    ytInitialPlayerResponse: {
      videoDetails: { videoId: "current" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [track] } }
    },
    setInterval: (callback: () => void) => { poll = callback; },
    setTimeout: (callback: () => void) => { callback(); }
  });
  await import("./page-bridge");
  poll();
  location.search = "?v=current&t=1224s&feature=share";
  poll();
  document.dispatchEvent(new Event("yt-navigate-finish"));
  expect(publish).toHaveBeenCalledOnce();
  track.baseUrl += "&updated=1";
  poll();
  expect(publish).toHaveBeenCalledTimes(2);
  document.dispatchEvent(new Event("tubetitle:request-tracks"));
  expect(publish).toHaveBeenCalledTimes(3);
  location.search = "?v=next";
  poll();
  expect(publish).toHaveBeenCalledTimes(4);
});

it.each([
  ["no transcript", 200, false],
  ["unavailable metadata", 503, false],
  ["its own transcript", 200, true]
] as const)("handles a new video with %s while the previous page remains in memory", async (_label, status, hasTranscript) => {
  vi.resetModules();
  const oldTranscript = { getTranscriptEndpoint: { params: "old-video-params" } };
  const oldSegment = {
    querySelector: (selector: string) => ({ textContent: selector.includes("Timestamp") ? "0:25" : "Previous video transcript." })
  };
  const oldPanel = {
    querySelector: () => oldSegment,
    querySelectorAll: () => [oldSegment]
  };
  const document = Object.assign(new EventTarget(), {
    getElementById: () => null,
    querySelector: (selector: string) => selector === "ytd-watch-flexy"
      ? { data: { currentVideoEndpoint: { watchEndpoint: { videoId: "old-video" } }, ...oldTranscript } }
      : null,
    querySelectorAll: () => [oldPanel]
  });
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (input.includes("/get_transcript")) return Response.json({
      transcriptSegmentRenderer: { startMs: "25000", endMs: "26000", snippet: { runs: [
        { text: request.params === "new-video-params" ? "Current video transcript." : "Previous video transcript." }
      ] } }
    });
    expect(request.videoId).toBe("new-video");
    return Response.json({
      currentVideoEndpoint: { watchEndpoint: { videoId: "new-video" } },
      ...(hasTranscript ? { getTranscriptEndpoint: { params: "new-video-params" } } : {})
    }, { status });
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=new-video"));
  vi.stubGlobal("window", {
    ytInitialData: oldTranscript,
    ytcfg: { get: (key: string) => key === "INNERTUBE_API_KEY" ? "test-key" : key === "INNERTUBE_CONTEXT" ? {} : undefined },
    setInterval: vi.fn(), setTimeout, clearTimeout
  });
  vi.stubGlobal("fetch", fetch);
  await import("./page-bridge");

  const result = new Promise<unknown>((resolve) => document.addEventListener("tubitle:transcript", (event) => {
    resolve((event as CustomEvent).detail);
  }, { once: true }));
  document.dispatchEvent(new CustomEvent("tubitle:request-transcript", { detail: { requestId: "test", videoId: "new-video" } }));

  if (hasTranscript) {
    expect(await result).toMatchObject({ videoId: "new-video", cues: [{ text: "Current video transcript." }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  } else {
    expect(await result).toMatchObject({ videoId: "new-video", error: expect.any(String) });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it.each([true, false, "wrong-language"] as const)("uses only current transcript rows in the source language: %s", async (newRows) => {
  vi.resetModules();
  const cc = { disabled: false, getAttribute: (name: string) => name === "aria-pressed" ? "true" : null };
  let transcript = "Old video transcript.";
  let expanded = false;
  const transcriptButton = { click: vi.fn(() => {
    expanded = true;
    if (newRows) transcript = newRows === "wrong-language" ? "這是錯誤語言的文字稿。" : "Current video transcript.";
  }) };
  const row = { querySelector: (selector: string) => ({ textContent: selector.includes("Timestamp") ? "0:25" : transcript }) };
  const panel = { querySelectorAll: (selector: string) => selector === "transcript-segment-view-model" ? [row] : [] };
  const watch = {
    getAttribute: () => "current",
    querySelector: () => transcriptButton,
    querySelectorAll: (selector: string) => !selector.includes("[visibility") || expanded ? [panel] : []
  };
  const document = Object.assign(new EventTarget(), {
    getElementById: () => ({ getPlayerResponse: () => ({ videoDetails: { videoId: "current" }, ...(newRows === "wrong-language" ? { captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?lang=en", languageCode: "en" }] } } } : {}) }) }),
    querySelector: (selector: string) => selector.startsWith("ytd-watch-flexy") ? watch : cc
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=current"));
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    ytcfg: { get: (key: string) => key === "INNERTUBE_API_KEY" ? "test-key" : key === "INNERTUBE_CONTEXT" ? {} : undefined },
    setInterval: vi.fn(), setTimeout, clearTimeout
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/get_transcript")
    ? Response.json({ error: { message: "Precondition check failed" } }, { status: 400 })
    : Response.json({ getTranscriptEndpoint: { params: "current" } })));
  await import("./page-bridge");
  try {
    const result = new Promise<unknown>((resolve) => document.addEventListener("tubitle:transcript", (event) => {
      resolve((event as CustomEvent).detail);
    }, { once: true }));
    document.dispatchEvent(new CustomEvent("tubitle:request-transcript", { detail: { requestId: "fallback", videoId: "current" } }));
    await vi.runAllTimersAsync();

    if (newRows === true) expect(await result).toMatchObject({ videoId: "current", cues: [{ text: "Current video transcript." }] });
    else expect(await result).toMatchObject({ videoId: "current", error: expect.any(String) });
    expect(transcriptButton.click).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("requests the English transcript rather than the localized Chinese default for an English source video", async () => {
  vi.resetModules();
  const document = Object.assign(new EventTarget(), {
    getElementById: () => ({ getPlayerResponse: () => ({
      videoDetails: { videoId: "5MuIMqhT8DM" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { baseUrl: "https://www.youtube.com/api/timedtext?lang=zh-TW", languageCode: "zh-TW" },
        { baseUrl: "https://www.youtube.com/api/timedtext?lang=en", languageCode: "en" }
      ] } }
    }) }),
    querySelector: () => null
  });
  const context = { client: { hl: "zh-TW", gl: "TW", clientVersion: "test-version" } };
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=5MuIMqhT8DM"));
  vi.stubGlobal("window", {
    ytcfg: { get: (key: string) => key === "INNERTUBE_API_KEY" ? "test-key" : key === "INNERTUBE_CONTEXT" ? context : undefined },
    setInterval: vi.fn(), setTimeout, clearTimeout
  });
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (input.includes("/next")) return Response.json({ getTranscriptEndpoint: {
      params: body.context.client.hl === "en" ? "english-params" : "chinese-params"
    } });
    return Response.json({ transcriptSegmentRenderer: {
      startMs: "355000", endMs: "368000", snippet: { runs: [{
        text: body.params === "english-params" ? "Sleep quality declines as we get older." : "我們同時所發現的是睡眠品質下降。"
      }] }
    } });
  });
  vi.stubGlobal("fetch", fetch);
  await import("./page-bridge");
  const result = new Promise<unknown>((resolve) => document.addEventListener("tubitle:transcript", (event) => {
    resolve((event as CustomEvent).detail);
  }, { once: true }));
  document.dispatchEvent(new CustomEvent("tubitle:request-transcript", {
    detail: { requestId: "localized", videoId: "5MuIMqhT8DM" }
  }));
  expect(await result).toMatchObject({ cues: [{ text: "Sleep quality declines as we get older." }] });
  expect(context.client.hl).toBe("zh-TW");
});

it.each(["en", "zh-CN"])("uses the modern transcript panel for the requested %s track", async (languageCode) => {
  vi.resetModules();
  const document = Object.assign(new EventTarget(), {
    getElementById: () => ({ getPlayerResponse: () => ({
      videoDetails: { videoId: "current" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: ["en", "zh-CN"].map((code) => ({
        baseUrl: `https://www.youtube.com/api/timedtext?lang=${code}`, languageCode: code
      })) } }
    }) }),
    querySelector: () => null
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=current"));
  vi.stubGlobal("window", {
    ytcfg: { get: (key: string) => key === "INNERTUBE_API_KEY" ? "test-key" : key === "INNERTUBE_CONTEXT" ? { client: { hl: "zh-TW" } } : undefined },
    setInterval: vi.fn(), setTimeout, clearTimeout
  });
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (input.includes("/next")) return Response.json({
      currentVideoEndpoint: { watchEndpoint: { videoId: "current" } },
      // The legacy entry remains present but is unusable on modern YouTube.
      getTranscriptEndpoint: { params: "broken-legacy-params" },
      videoDescriptionTranscriptSectionRenderer: { primaryButton: { buttonRenderer: { command: {
        commandExecutorCommand: { commands: [{ updateEngagementPanelContentCommand: {
          contentSourcePanelIdentifier: { tag: "PAmodern_transcript_view" },
          globalConfiguration: { params: "modern-current-video" }
        } }] }
      } } } }
    });
    expect(input).toContain("/get_panel?");
    expect(request).toMatchObject({ panelId: "PAmodern_transcript_view", params: "modern-current-video", context: { client: { hl: languageCode } } });
    return Response.json({ content: { rows: [
      { transcriptSegmentViewModel: { timestamp: "5:55", simpleText: languageCode === "en" ? "Sleep quality declines as we get older." : "睡眠品质会随着年龄增长而下降。" } },
      { transcriptSegmentViewModel: { timestamp: "6:08", simpleText: languageCode === "en" ? "These findings matter." : "这些发现很重要。" } }
    ] } });
  });
  vi.stubGlobal("fetch", fetch);
  await import("./page-bridge");
  const result = new Promise<unknown>((resolve) => document.addEventListener("tubitle:transcript", (event) => {
    resolve((event as CustomEvent).detail);
  }, { once: true }));
  document.dispatchEvent(new CustomEvent("tubitle:request-transcript", { detail: { requestId: "modern", videoId: "current", languageCode } }));
  expect(await result).toMatchObject({ cues: [
    { text: languageCode === "en" ? "Sleep quality declines as we get older." : "睡眠品质会随着年龄增长而下降。", startMs: 355000, endMs: 368000 },
    { startMs: 368000, endMs: 370000 }
  ] });
  expect(fetch).toHaveBeenCalledTimes(2);
});
