import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./shared/settings";
import { tubitleConnection } from "./shared/tubitle-connection";
import { getTubitleModel, translateLocally } from "./local-providers";

afterEach(() => vi.unstubAllGlobals());

describe("Tubitle local and VPS connections", () => {
  it("keeps loopback defaults and refuses sending credentials to insecure remote URLs", () => {
    expect(tubitleConnection(DEFAULT_SETTINGS)).toEqual({ origin: "http://127.0.0.1:18081", headers: {} });
    for (const tubitleBaseUrl of ["http://example.com", "https://user:password@example.com", "https://example.com?key=secret", "https://example.com/v1"]) {
      expect(() => tubitleConnection({ ...DEFAULT_SETTINGS, tubitleBaseUrl })).toThrow();
    }
  });

  it("uses the configured HTTPS service and bearer key for health and translation", async () => {
    const settings = { ...DEFAULT_SETTINGS, tubitleBaseUrl: "https://translate.example.com/", tubitleApiKey: " test-access-key " };
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ready: true, model: "lmt-60-0.6b-q4" }))
      .mockResolvedValueOnce(Response.json({ translation: "测试译文", finishReason: "stop" }));
    vi.stubGlobal("fetch", request);
    const model = await getTubitleModel(settings);
    expect(await translateLocally("hy-mt-local", "Test.", settings, "en", undefined, model)).toBe("测试译文");
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://translate.example.com/health", "https://translate.example.com/v1/translate"
    ]);
    for (const [, options] of request.mock.calls) {
      expect(options?.headers).toMatchObject({ Authorization: "Bearer test-access-key" });
      expect(options?.redirect).toBe("error");
    }
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toMatchObject({ source: "en", target: "zh", expectedModel: model });
  });

  it("does not share pending model discovery between different servers", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => Response.json({ ready: true, model: String(url).includes("one.") ? "one" : "two" }));
    vi.stubGlobal("fetch", request);
    expect(await Promise.all([
      getTubitleModel({ ...DEFAULT_SETTINGS, tubitleBaseUrl: "https://one.example.com" }),
      getTubitleModel({ ...DEFAULT_SETTINGS, tubitleBaseUrl: "https://two.example.com" })
    ])).toEqual(["one", "two"]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
