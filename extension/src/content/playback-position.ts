/** YouTube can expose 0/ad/seek times before applying a watch link's timestamp. */
export class CaptionPlaybackPosition {
  private target?: number;
  private waitingSince?: number;
  private stableSince?: number;
  private lastTime?: number;

  reset(url: string): void {
    const page = new URL(url);
    const value = page.searchParams.get("t") ?? page.searchParams.get("start") ??
      new URLSearchParams(page.hash.slice(1)).get("t") ?? "";
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(value);
    const seconds = match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
    this.target = seconds > 0 && Number.isFinite(seconds) ? seconds : undefined;
    this.waitingSince = this.stableSince = this.lastTime = undefined;
  }

  get pending(): boolean { return this.target !== undefined; }

  ready(video: Pick<HTMLVideoElement, "currentTime" | "duration" | "seeking" | "readyState">, now: number, advertising: boolean): boolean {
    if (advertising || video.seeking || video.readyState < 2 || !Number.isFinite(video.currentTime)) {
      this.waitingSince = undefined;
      this.stableSince = undefined;
      return false;
    }
    if (this.target === undefined) return true;
    this.waitingSince ??= now;
    const target = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(this.target, video.duration) : this.target;
    // Bound the wait if the player ignores the URL's timestamp.
    const reached = video.currentTime >= target - 1 || now - this.waitingSince >= 10_000;
    if (!reached || (this.lastTime !== undefined && Math.abs(video.currentTime - this.lastTime) > 1)) {
      this.stableSince = undefined;
    }
    this.lastTime = video.currentTime;
    if (!reached) return false;
    this.stableSince ??= now;
    if (now - this.stableSince < 250) return false;
    this.target = undefined;
    return true;
  }
}
