import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

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

it.each([true, false])("uses only newly rendered transcript rows when the native button loads new content: %s", async (newRows) => {
  vi.resetModules();
  const cc = { disabled: false, getAttribute: (name: string) => name === "aria-pressed" ? "true" : null };
  let transcript = "Old video transcript.";
  let expanded = false;
  const transcriptButton = { click: vi.fn(() => {
    expanded = true;
    if (newRows) transcript = "Current video transcript.";
  }) };
  const row = { querySelector: (selector: string) => ({ textContent: selector.includes("Timestamp") ? "0:25" : transcript }) };
  const panel = { querySelectorAll: (selector: string) => selector === "transcript-segment-view-model" ? [row] : [] };
  const watch = {
    getAttribute: () => "current",
    querySelector: () => transcriptButton,
    querySelectorAll: (selector: string) => !selector.includes("[visibility") || expanded ? [panel] : []
  };
  const document = Object.assign(new EventTarget(), {
    getElementById: () => ({ getPlayerResponse: () => ({ videoDetails: { videoId: "current" } }) }),
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

    if (newRows) expect(await result).toMatchObject({ videoId: "current", cues: [{ text: "Current video transcript." }] });
    else expect(await result).toMatchObject({ videoId: "current", error: expect.any(String) });
    expect(transcriptButton.click).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
