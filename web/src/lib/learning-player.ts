export interface StudyPlayer {
  cueVideoById(target: { videoId: string; startSeconds: number }): void;
  loadVideoById(target: { videoId: string; startSeconds: number }): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
// Keep one player for the whole study session, including video changes.
export class StudyPlayback {
  private videoId = '';
  constructor(private player: StudyPlayer) {}
  pause() { this.player.pauseVideo(); }
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
