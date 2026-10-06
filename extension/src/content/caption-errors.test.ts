import { describe, expect, it } from "vitest";
import { captionErrorNotice } from "./caption-errors";

describe("caption error notices", () => {
  it("summarizes missing captions even when transcript fallback errors follow", () => {
    expect(captionErrorNotice("这个视频没有可用的字幕；文字稿回退失败：读取 YouTube 文字稿失败 (400)：Precondition check failed.；页面回退失败：YouTube 页面没有文字稿入口"))
      .toBe("此视频暂无可用字幕");
  });
  it("handles legacy empty caption errors", () => {
    for (const detail of ["没有可用的英文字幕", "字幕轨道为空", "YouTube 文字稿为空"]) {
      expect(captionErrorNotice(detail)).toBe("此视频暂无可用字幕");
    }
  });
  it("does not misreport network or service failures as missing captions", () => {
    expect(captionErrorNotice("读取字幕失败 (503)；文字稿回退失败：读取 YouTube 文字稿超时"))
      .toBe("字幕暂时无法加载，请稍后刷新重试");
  });
});
