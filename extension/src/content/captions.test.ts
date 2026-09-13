import { afterEach, describe, expect, it, vi } from "vitest";
import { cuesToSentences, fetchEnglishSentences } from "./captions";

afterEach(() => vi.unstubAllGlobals());

describe("cuesToSentences", () => {
  it("merges caption fragments into natural sentences", () => {
    const result = cuesToSentences([
      { text: "This is", startMs: 0, endMs: 900 },
      { text: "a test.", startMs: 900, endMs: 1800 },
      { text: "It works!", startMs: 1900, endMs: 3000 }
    ]);
    expect(result.map((item) => item.text)).toEqual(["This is a test.", "It works!"]);
  });

  it("collapses rolling automatic captions", () => {
    const result = cuesToSentences([
      { text: "we need", startMs: 0, endMs: 900 },
      { text: "we need better", startMs: 500, endMs: 1400 },
      { text: "we need better tools.", startMs: 1000, endMs: 2200 }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe("we need better tools.");
  });

  it("starts a new sentence after a long timing gap", () => {
    const result = cuesToSentences([
      { text: "First fragment", startMs: 0, endMs: 800 },
      { text: "Second fragment", startMs: 3000, endMs: 4000 }
    ]);
    expect(result).toHaveLength(2);
  });

  it("orders out-of-order cues by timeline before creating the sentence sequence", () => {
    const result = cuesToSentences([
      { text: "Second.", startMs: 3000, endMs: 4000 },
      { text: "First.", startMs: 1000, endMs: 2000 }
    ]);
    expect(result.map((item) => item.text)).toEqual(["First.", "Second."]);
    expect(result.map((item) => item.startMs)).toEqual([1000, 3000]);
  });

  it("keeps every split sentence inside the source cue timeline", () => {
    const result = cuesToSentences([
      { text: "A. B. C. D.", startMs: 1000, endMs: 1200 }
    ]);
    expect(result).toHaveLength(4);
    expect(result.every((item) => item.endMs <= 1200 && item.endMs > item.startMs)).toBe(true);
  });

  it("reports an actionable error when YouTube returns an empty caption body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { status: 200 })));
    await expect(fetchEnglishSentences([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=test",
      languageCode: "en",
      name: "English"
    }])).rejects.toThrow("字幕服务返回了空响应，请刷新视频页面后重试");
  });

  it("reports an actionable error when caption JSON is incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("{", { status: 200 })));
    await expect(fetchEnglishSentences([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=test",
      languageCode: "en",
      name: "English"
    }])).rejects.toThrow("字幕数据格式异常，请刷新视频页面后重试");
  });

  it("reads the original signed SRV3 response without changing its format", async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response(
      '<timedtext><body><p t="0" d="1200"><s>Welcome &amp; hello.</s></p><p t="1200" d="800"><s>Let&apos;s go!</s></p></body></timedtext>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    ));
    vi.stubGlobal("fetch", mockedFetch);
    const result = await fetchEnglishSentences([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=test&signature=signed",
      languageCode: "en-US",
      name: "English"
    }]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://www.youtube.com/api/timedtext?v=test&signature=signed",
      { credentials: "include" }
    );
    expect(result.map((item) => item.text)).toEqual(["Welcome & hello.", "Let's go!"]);
  });
});
