import { afterEach, describe, expect, it, vi } from "vitest";
import { cuesToSentences, fetchEnglishSentences } from "./captions";

afterEach(() => vi.unstubAllGlobals());

describe("cuesToSentences", () => {
  it("bounds unpunctuated automatic captions from the reported conversation", () => {
    const fragments = [
      "straightforward and direct right right right right exactly so um what's another one Lindsay all right so could be better",
      "and this one's also more direct a little more direct for example Michelle how's the soup eh could be better yeah yeah",
      "do you like soup are you a soup eater um some uh yes I like soup but I can't eat soup as that that's my whole meal",
      "I can't just have soup and a piece of bread and that's my whole meal I don't feel I I can have it as a starter",
      "I can have it on the side but I can't imagine just having it as a whole meal you too I feel that way too it's a disappointment"
    ];
    const result = cuesToSentences(fragments.map((text, index) => ({ text, startMs: index * 5000, endMs: (index + 1) * 5000 })));
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((item) => item.text.length <= 200)).toBe(true);
    expect(result.map((item) => item.text).join(" ")).toBe(fragments.join(" "));
    expect(result[0]?.startMs).toBe(0);
    expect(result.at(-1)?.endMs).toBe(25000);
  });

  it("splits an oversized sentence at a clause rather than an arbitrary word", () => {
    const first = "We planned the whole journey carefully and brought enough food for everyone in our group";
    const second = "but the weather changed overnight and we had to find another route through the mountains before we could reach the village.";
    const result = cuesToSentences([{ text: `${first}, ${second}`, startMs: 0, endMs: 12000 }]);
    expect(result.map((item) => item.text)).toEqual([`${first},`, second]);
  });

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

  it("keeps a sentence below 200 characters intact between short sentences", () => {
    const long = "This sentence " + "continues ".repeat(15) + "until here.";
    const result = cuesToSentences([{ text: `Before. ${long} After.`, startMs: 0, endMs: 10000 }]);
    expect(result.map((item) => item.text)).toEqual(["Before.", long, "After."]);
  });

  it("packs Chinese sentences only at complete sentence boundaries", () => {
    const first = "短句。";
    const long = "这是一个很长但必须完整显示的句子".repeat(10) + "。";
    const result = cuesToSentences([{ text: `${first}${long}下一句。最后一句！`, startMs: 0, endMs: 10000 }]);
    expect(result.map((item) => item.text)).toEqual([first, long, "下一句。最后一句！"]);
  });

  it("keeps unpunctuated fragments below 200 characters intact", () => {
    const text = "an unfinished sentence ".repeat(8).trim();
    expect(cuesToSentences([{ text, startMs: 0, endMs: 10000 }]).map((item) => item.text)).toEqual([text]);
  });

  it("preserves exactly 200 characters and splits only above that limit", () => {
    const text = "word ".repeat(39) + "end!.";
    expect(text).toHaveLength(200);
    expect(cuesToSentences([{ text, startMs: 0, endMs: 5000 }]).map((item) => item.text)).toEqual([text]);
    const longer = text.slice(0, -1) + "x.";
    const result = cuesToSentences([{ text: longer, startMs: 0, endMs: 5000 }]);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((item) => item.text.length <= 200)).toBe(true);
    expect(result.map((item) => item.text).join(" ")).toBe(longer);
  });

  it("prefers a clear pause when an oversized sentence has no punctuation", () => {
    const first = "We discussed all the details of our journey and made sure that everyone understood the plan";
    const second = "the weather changed overnight so we had to find another route through the mountains before we could reach the village safely";
    const result = cuesToSentences([
      { text: first, startMs: 0, endMs: 5000 },
      { text: second, startMs: 5700, endMs: 12000 }
    ]);
    expect(result.map((item) => item.text)).toEqual([first, second]);
    expect(result.map((item) => [item.startMs, item.endMs])).toEqual([[0, 5000], [5700, 12000]]);
  });

  it("prefers a clause connector in an unpunctuated oversized cue", () => {
    const first = "We discussed all the details of our journey and made sure that everyone understood the plan";
    const second = "but the weather changed overnight forcing everyone to find another route through the mountains before reaching the village";
    const result = cuesToSentences([{ text: `${first} ${second}`, startMs: 0, endMs: 12000 }]);
    expect(result.map((item) => item.text)).toEqual([first, second]);
  });

  it("bounds Chinese sentences without spaces and keeps every character", () => {
    const first = "我们需要完整表达这个想法".repeat(8) + "，";
    const second = "然后继续说明接下来需要完成的事情".repeat(9) + "。";
    const text = first + second;
    const result = cuesToSentences([{ text, startMs: 0, endMs: 12000 }]);
    expect(result.map((item) => item.text)).toEqual([first, second]);
    expect(result.every((item) => item.text.length <= 200)).toBe(true);
    expect(result.map((item) => item.text).join("")).toBe(text);
  });

  it("bounds text with no usable boundaries without breaking Unicode characters", () => {
    const text = "字" + "😀".repeat(250);
    const result = cuesToSentences([{ text, startMs: 0, endMs: 12000 }]);
    expect(result.every((item) => item.text.length <= 200)).toBe(true);
    expect(result.map((item) => item.text).join("")).toBe(text);
    expect(result.every((item) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(item.text))).toBe(true);
    expect(result.every((item, index) => item.endMs > item.startMs &&
      (index === 0 || item.startMs >= result[index - 1]!.endMs))).toBe(true);
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
  it("aligns official translations without regrouping either track", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    const long = "Keep this long sentence complete " + "throughout ".repeat(12) + "the caption.";
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
  it.each(["hy-mt-local", "microsoft", "google", "tencent"] as const)("uses official bilingual tracks with provider %s", async (provider) => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    const fetchMock = vi.fn(async (url: string) => Response.json({ events: [{
      tStartMs: 355000, dDurationMs: 13000,
      segs: [{ utf8: url.includes("lang=zh-CN") ? "睡眠品质会随着年龄增长而下降。" : "Sleep quality declines as we get older." }]
    }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBilingualCaptions(["en", "zh-CN"].map((languageCode) => ({
      baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode
    })), { ...DEFAULT_SETTINGS, provider, targetLanguage: "zh" });
    expect(result.sentences[0]?.text).toBe("Sleep quality declines as we get older.");
    expect([...result.officialTranslations.values()]).toEqual(["睡眠品质会随着年龄增长而下降。"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith("https://www.youtube.com/"))).toBe(true);
  });
  it("loads both selected languages through transcript fallback when timed text is unavailable", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
    const fallback = vi.fn(async (language: string) => [{
      text: language === "en" ? "Sleep quality declines as we get older." : "睡眠品质会随着年龄增长而下降。",
      startMs: 355000, endMs: 368000
    }]);
    const result = await fetchBilingualCaptions(["en", "zh-CN"].map((languageCode) => ({
      baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode
    })), { ...DEFAULT_SETTINGS, provider: "hy-mt-local", targetLanguage: "zh" }, fallback);
    expect(fallback.mock.calls).toEqual([["en"], ["zh-CN"]]);
    expect(result.sourceLanguage).toBe("en");
    expect(result.sentences[0]?.text).toBe("Sleep quality declines as we get older.");
    expect([...result.officialTranslations.values()]).toEqual(["睡眠品质会随着年龄增长而下降。"]);
  });

  it("leaves an unreadable target track unmatched for service translation", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("lang=zh-CN") ? new Response("", { status: 503 }) :
      Response.json({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello." }] }] })));
    const result = await fetchBilingualCaptions(["en", "zh-CN"].map((languageCode) => ({
      baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode
    })), { ...DEFAULT_SETTINGS, targetLanguage: "zh" });
    expect(result.sentences[0]?.text).toBe("Hello.");
    expect(result.officialTranslations.size).toBe(0);
  });

  it("uses the configured official target track", async () => {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: url.includes("lang=fr") ? "Bonjour." : "Hello." }] }] }))));
    const result = await fetchBilingualCaptions(["en", "fr", "zh"].map((languageCode) => ({ baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode })), { ...DEFAULT_SETTINGS, serviceMode: "custom", provider: "microsoft", targetLanguage: "fr" });
    expect([...result.officialTranslations.values()]).toEqual(["Bonjour."]);
  });
});

describe("official bilingual alignment", () => {
  const tracks = ["en", "zh-CN"].map((languageCode) => ({
    baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, name: languageCode
  }));
  const source = [
    { text: "First sentence. Another short sentence.", startMs: 0, endMs: 1000 },
    { text: "Next sentence.", startMs: 1000, endMs: 2000 }
  ];
  async function load(target: typeof source, original = source) {
    const { fetchBilingualCaptions } = await import("./captions");
    const { DEFAULT_SETTINGS } = await import("../shared/settings");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ events:
      (url.includes("lang=en") ? original : target).map((cue) => ({
        tStartMs: cue.startMs, dDurationMs: cue.endMs - cue.startMs, segs: [{ utf8: cue.text }]
      }))
    })));
    return fetchBilingualCaptions(tracks, { ...DEFAULT_SETTINGS, targetLanguage: "zh" });
  }

  it("preserves both official tracks' cue boundaries without sentence regrouping", async () => {
    const result = await load([
      { text: "第一句。另一句短句。", startMs: 0, endMs: 1000 },
      { text: "下一句。", startMs: 1000, endMs: 2000 }
    ]);
    expect(result.sentences.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }))).toEqual(source);
    expect(result.sentences.map((cue) => result.officialTranslations.get(cue.id))).toEqual(["第一句。另一句短句。", "下一句。"]);
  });

  it("rejects a broad target cue spanning several source cues", async () => {
    const result = await load([{ text: "第一句。另一句短句。下一句。", startMs: 0, endMs: 2000 }]);
    expect(result.officialTranslations.size).toBe(0);
    expect(result.sentences).toHaveLength(2);
  });

  it("keeps a reliable pair and rejects a neighbouring pair with different timing", async () => {
    const result = await load([
      { text: "第一句。另一句短句。", startMs: 0, endMs: 1000 },
      { text: "其他时段的内容。", startMs: 1400, endMs: 3000 }
    ]);
    expect(result.sentences.map((cue) => result.officialTranslations.get(cue.id))).toEqual(["第一句。另一句短句。", undefined]);
  });

  it("accepts small timing roundoff without importing adjacent cues", async () => {
    const result = await load([
      { text: "第一句。另一句短句。", startMs: 20, endMs: 980 },
      { text: "下一句。", startMs: 1020, endMs: 1980 }
    ]);
    expect(result.sentences.map((cue) => result.officialTranslations.get(cue.id))).toEqual(["第一句。另一句短句。", "下一句。"]);
  });

  it("never reuses one target cue for multiple competing source cues", async () => {
    const result = await load([{ text: "只有一个译文。", startMs: 0, endMs: 1000 }], [
      { text: "First candidate.", startMs: 0, endMs: 1000 },
      { text: "Second candidate.", startMs: 10, endMs: 1010 }
    ]);
    expect(result.officialTranslations.size).toBe(0);
  });

  it("preserves an official cue longer than 200 characters when both tracks exist", async () => {
    const text = "An official caption with original timing ".repeat(8).trim();
    const result = await load([{ text: "完整的官方译文。", startMs: 0, endMs: 5000 }], [{ text, startMs: 0, endMs: 5000 }]);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]?.text).toBe(text);
    expect([...result.officialTranslations.values()]).toEqual(["完整的官方译文。"]);
  });

  it("rejects ambiguous duplicate target cues", async () => {
    const result = await load([
      { text: "第一版。", startMs: 0, endMs: 1000 },
      { text: "第二版。", startMs: 0, endMs: 1000 }
    ]);
    expect(result.officialTranslations.size).toBe(0);
  });
});
