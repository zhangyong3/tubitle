import { afterEach, describe, expect, it, vi } from "vitest";
import { cuesToSentences, fetchEnglishSentences } from "./captions";

afterEach(() => vi.unstubAllGlobals());

describe("cuesToSentences", () => {
  it("keeps the screenshot sentence together even when it exceeds the preferred length", () => {
    const first = "Don't spend the majority of your younger years sacrificing your health to make a living only to spend that very same";
    const second = "money in your later years trying to get your health back.";
    const result = cuesToSentences([
      { text: first, startMs: 137000, endMs: 148000 },
      { text: second, startMs: 148000, endMs: 153000 }
    ]);
    expect(result.map((item) => item.text)).toEqual([`${first} ${second}`]);
    expect(result[0]).toMatchObject({ startMs: 137000, endMs: 153000 });
  });

  it("packs short complete sentences within the preferred length", () => {
    const result = cuesToSentences([{ text: "Hello there. Welcome back! Let's begin.", startMs: 0, endMs: 3000 }]);
    expect(result.map((item) => item.text)).toEqual(["Hello there. Welcome back! Let's begin."]);
  });

  it("does not split an unfinished sentence at a long pause", () => {
    const result = cuesToSentences([
      { text: "Keep the same", startMs: 0, endMs: 1000 },
      { text: "sentence together.", startMs: 4000, endMs: 6000 }
    ]);
    expect(result.map((item) => item.text)).toEqual(["Keep the same sentence together."]);
  });

  it("merges caption fragments into natural sentences", () => {
    const result = cuesToSentences([
      { text: "This is", startMs: 0, endMs: 900 },
      { text: "a test.", startMs: 900, endMs: 1800 },
      { text: "It works!", startMs: 1900, endMs: 3000 }
    ]);
    expect(result.map((item) => item.text)).toEqual(["This is a test. It works!"]);
  });

  it("keeps titles and decimals within the sentence, including across cues", () => {
    const result = cuesToSentences([
      { text: "I asked Dr.", startMs: 0, endMs: 900 },
      { text: "Chen about version 3.5. It works.", startMs: 900, endMs: 2700 }
    ]);
    expect(result.map((item) => item.text)).toEqual(["I asked Dr. Chen about version 3.5. It works."]);
  });

  it("keeps a long single sentence intact without losing words", () => {
    const text = "We started walking through the quiet forest, and after we passed several streams and steep hills we found a small cabin, but nobody was home so we continued toward the lake where we planned to rest.";
    const result = cuesToSentences([{ text, startMs: 2000, endMs: 14000 }]);
    expect(result).toHaveLength(1);
    expect(result.map((item) => item.text).join(" ")).toBe(text);
    expect(result[0]?.startMs).toBe(2000);
    expect(result.at(-1)?.endMs).toBe(14000);
  });

  it("starts another caption before adding a sentence that exceeds the length budget", () => {
    const first = "a".repeat(59) + ".";
    const second = "b".repeat(58) + ".";
    const third = "Next.";
    const result = cuesToSentences([{ text: `${first} ${second} ${third}`, startMs: 0, endMs: 12500 }]);
    expect(result.map((item) => item.text)).toEqual([`${first} ${second}`, third]);
    expect(result[0]?.text).toHaveLength(120);
    expect(result[0]?.endMs).toBeLessThan(result[1]!.startMs);
    expect(result.at(-1)?.endMs).toBe(12500);
  });

  it("keeps an oversized sentence on its own between short sentences", () => {
    const long = "This sentence " + "continues ".repeat(20) + "until here.";
    const result = cuesToSentences([{ text: `Before. ${long} After.`, startMs: 0, endMs: 10000 }]);
    expect(result.map((item) => item.text)).toEqual(["Before.", long, "After."]);
  });

  it("packs Chinese sentences only at complete sentence boundaries", () => {
    const first = "短句。";
    const long = "这是一个很长但必须完整显示的句子".repeat(10) + "。";
    const result = cuesToSentences([{ text: `${first}${long}下一句。最后一句！`, startMs: 0, endMs: 10000 }]);
    expect(result.map((item) => item.text)).toEqual([first, long, "下一句。最后一句！"]);
  });

  it("keeps unpunctuated fragments intact rather than guessing sentence boundaries", () => {
    const text = "an unfinished sentence ".repeat(10).trim();
    expect(cuesToSentences([{ text, startMs: 0, endMs: 10000 }]).map((item) => item.text)).toEqual([text]);
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

  it("keeps complete sentences separate after a long timing gap", () => {
    const result = cuesToSentences([
      { text: "First sentence.", startMs: 0, endMs: 800 },
      { text: "Second sentence.", startMs: 3000, endMs: 4000 }
    ]);
    expect(result).toHaveLength(2);
  });

  it("orders out-of-order cues by timeline before creating the sentence sequence", () => {
    const result = cuesToSentences([
      { text: "Second.", startMs: 3000, endMs: 4000 },
      { text: "First.", startMs: 1000, endMs: 2000 }
    ]);
    expect(result.map((item) => item.text)).toEqual(["First. Second."]);
    expect(result.map((item) => item.startMs)).toEqual([1000]);
  });

  it("keeps packed sentences inside the source cue timeline", () => {
    const result = cuesToSentences([
      { text: "A. B. C. D.", startMs: 1000, endMs: 1200 }
    ]);
    expect(result).toHaveLength(1);
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
    expect(result.map((item) => item.text)).toEqual(["Welcome & hello. Let's go!"]);
  });
});

 describe("configurable caption languages", () => {
  it("keeps Chinese source captions without fetching a duplicate translation", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "这是中文字幕。" }] }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBilingualCaptions([{ baseUrl: "https://www.youtube.com/api/timedtext", languageCode: "zh-Hans", name: "中文" }]);
    expect(result.sourceLanguage).toBe("zh-Hans");
    expect(result.sentences[0]?.text).toBe("这是中文字幕。");
    expect(result.officialTranslations.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aligns official translations before packing target sentences", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    const long = "Keep this long sentence complete " + "throughout ".repeat(15) + "the caption.";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: url.includes("lang=fr") ? "Première traduction." : long }] },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: url.includes("lang=fr") ? "Deuxième traduction." : "Next sentence." }] }
      ]
    }))));
    const result = await fetchBilingualCaptions(["en", "fr"].map((languageCode) => ({
      baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode
    })), { ...DEFAULT_SETTINGS, serviceMode: "custom", provider: "microsoft", targetLanguage: "fr" });
    expect(result.sentences.map((item) => item.text)).toEqual([long, "Next sentence."]);
    expect(result.sentences.map((item) => result.officialTranslations.get(item.id)))
      .toEqual(["Première traduction.", "Deuxième traduction."]);
  });
  it("uses the configured official target track", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: url.includes("lang=fr") ? "Bonjour." : "Hello." }] }] }))));
    const result = await fetchBilingualCaptions(["en", "fr", "zh"].map((languageCode) => ({ baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode })), { ...DEFAULT_SETTINGS, serviceMode: "custom", provider: "microsoft", targetLanguage: "fr" });
    expect([...result.officialTranslations.values()]).toEqual(["Bonjour."]);
  });
});
