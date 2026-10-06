/** Keep service diagnostics out of the player and transcript list. */
export function captionErrorNotice(detail: string): string {
  if (/没有可用的(?:英文)?字幕|字幕轨道为空|文字稿为空/.test(detail)) {
    return "此视频暂无可用字幕";
  }
  return "字幕暂时无法加载，请稍后刷新重试";
}

export const CAPTION_NOTICE_DURATION_MS = 3000;
