import { describe, expect, it } from "vitest";
import { readJsonResponse } from "./api-client";

describe("readJsonResponse", () => {
  it("does not expose the native JSON error for an empty response", async () => {
    await expect(readJsonResponse(new Response("", { status: 200 }))).rejects.toThrow("服务端返回了空响应，请稍后重试");
  });

  it("reports invalid proxy or server output clearly", async () => {
    await expect(readJsonResponse(new Response("<html>", { status: 200 }))).rejects.toThrow("服务端返回了无法识别的数据");
  });
});
