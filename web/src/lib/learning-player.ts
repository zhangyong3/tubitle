export interface StudyPlayer {
  cueVideoById(target: { videoId: string; startSeconds: number }): void;
  loadVideoById(target: { videoId: string; startSeconds: number }): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  destroy(): void;
}
// Keep one player for the whole study session, including video changes.
export class StudyPlayback {
  private videoId = '';
  constructor(private player: StudyPlayer) {}
  pause() { this.player.pauseVideo(); }
  changeRate(direction: -1 | 0 | 1) {
    const rates = [...this.player.getAvailablePlaybackRates()].sort((a, b) => a - b);
    const current = this.player.getPlaybackRate();
    const rate = direction === 0 ? rates.find(value => value === 1)
      : direction < 0 ? rates.filter(value => value < current).at(-1)
      : rates.find(value => value > current);
    if (rate !== undefined) this.player.setPlaybackRate(rate);
  }
  toggle() {
    const state = this.player.getPlayerState();
    if (state === 1 || state === 3) this.player.pauseVideo();
    else this.player.playVideo();
  }
  select(videoId: string, seconds: number, play: boolean) {
    if (!videoId) { this.player.pauseVideo(); return; }
    if (videoId !== this.videoId) {
      const target = { videoId, startSeconds: seconds };
      if (play) this.player.loadVideoById(target);
      else this.player.cueVideoById(target);
      this.videoId = videoId;
    } else {
      this.player.seekTo(seconds, true);
      if (play) this.player.playVideo();
    }
  }
}
