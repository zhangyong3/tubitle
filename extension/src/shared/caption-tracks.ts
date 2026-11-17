import type { CaptionTrack } from "./types";

export function selectSourceTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const english = tracks.filter((track) => /^en(?:-|$)/i.test(track.languageCode));
  return english.find((track) => track.kind !== "asr") ?? english[0] ?? tracks.find((track) => track.kind === "asr") ?? tracks[0];
}

export type RawCaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  isTranslatable?: boolean;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
};

export type YouTubePlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: RawCaptionTrack[] };
  };
};

export function captionTracksForVideo(
  response: YouTubePlayerResponse | undefined,
  expectedVideoId: string | null
): CaptionTrack[] {
  if (expectedVideoId && response?.videoDetails?.videoId !== expectedVideoId) return [];
  const raw = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!raw) return [];
  return raw.flatMap((track) => {
    if (!track.baseUrl || !track.languageCode) return [];
    const name =
      track.name?.simpleText ??
      track.name?.runs?.map((run) => run.text ?? "").join("") ??
      track.languageCode;
    return [{
      baseUrl: track.baseUrl,
      languageCode: track.languageCode,
      name,
      kind: track.kind,
      isTranslatable: track.isTranslatable
    }];
  });
}
