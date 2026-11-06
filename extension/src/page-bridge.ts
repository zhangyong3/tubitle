import { captionTracksForVideo, type YouTubePlayerResponse } from "./shared/caption-tracks";
import {
  findSearchableTranscriptParams,
  findTranscriptParams,
  transcriptCuesFromResponse,
  transcriptCuesFromRows,
  type TranscriptCue
} from "./shared/youtube-transcript";

declare global {
  interface Window {
    ytInitialPlayerResponse?: YouTubePlayerResponse;
    ytInitialData?: unknown;
    ytcfg?: { get?: (name: string) => unknown };
  }
}

function getPlayerResponse(expectedVideoId: string | null): YouTubePlayerResponse | undefined {
  const player = document.getElementById("movie_player") as
    | (HTMLElement & { getPlayerResponse?: () => YouTubePlayerResponse })
    | null;
  try {
    const live = player?.getPlayerResponse?.();
    if (!expectedVideoId || live?.videoDetails?.videoId === expectedVideoId) return live ?? window.ytInitialPlayerResponse;
    if (window.ytInitialPlayerResponse?.videoDetails?.videoId === expectedVideoId) return window.ytInitialPlayerResponse;
    return live;
  } catch {
    return window.ytInitialPlayerResponse;
  }
}

function readTracks() {
  const videoId = new URL(location.href).searchParams.get("v");
  return captionTracksForVideo(getPlayerResponse(videoId), videoId);
}

function readCookie(name: string): string | undefined {
  const encodedName = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(encodedName)) return cookie.slice(encodedName.length);
  }
  return undefined;
}

async function addYouTubeSessionHeaders(headers: Record<string, string>): Promise<void> {
  if (window.ytcfg?.get?.("LOGGED_IN") !== true) return;
  headers["X-Youtube-Bootstrap-Logged-In"] = "true";
  headers["X-Goog-Authuser"] = String(window.ytcfg?.get?.("SESSION_INDEX") ?? 0);
  const delegatedSessionId = window.ytcfg?.get?.("DELEGATED_SESSION_ID");
  if (typeof delegatedSessionId === "string" && delegatedSessionId) {
    headers["X-Goog-PageId"] = delegatedSessionId;
  }

  const sapisid = readCookie("SAPISID");
  if (!sapisid || !crypto.subtle) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp} ${sapisid} ${location.origin}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  headers.Authorization = `SAPISIDHASH ${timestamp}_${hash}`;
}

async function youtubeResponseError(response: Response): Promise<Error> {
  let detail = "";
  try {
    const value = await response.json() as { error?: { message?: unknown } };
    if (typeof value.error?.message === "string") detail = value.error.message.trim();
  } catch {
    // YouTube sometimes returns an empty or non-JSON error body.
  }
  const suffix = detail ? `：${detail.slice(0, 160)}` : "";
  return new Error(`读取 YouTube 文字稿失败 (${response.status})${suffix}`);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

let lastSignature = "";
function publishTracks(): void {
  const tracks = readTracks();
  const signature = `${location.href}|${tracks.map((track) => track.baseUrl).join("|")}`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  document.dispatchEvent(
    new CustomEvent("tubetitle:tracks", { detail: { tracks, url: location.href } })
  );
}

document.addEventListener("yt-navigate-finish", () => {
  lastSignature = "";
  window.setTimeout(publishTracks, 250);
  window.setTimeout(publishTracks, 1200);
  window.setTimeout(publishTracks, 3000);
});
document.addEventListener("DOMContentLoaded", publishTracks);
document.addEventListener("tubetitle:request-tracks", () => {
  lastSignature = "";
  publishTracks();
});

function watchDataVideoId(data: unknown): string | undefined {
  return (data as { currentVideoEndpoint?: { watchEndpoint?: { videoId?: string } } } | null | undefined)
    ?.currentVideoEndpoint?.watchEndpoint?.videoId;
}

async function fetchTranscriptFromApi(videoId: string) {
  if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("视频已经切换");
  const watchData = (document.querySelector("ytd-watch-flexy") as (HTMLElement & { data?: unknown }) | null)?.data;
  const apiKey = window.ytcfg?.get?.("INNERTUBE_API_KEY");
  const context = window.ytcfg?.get?.("INNERTUBE_CONTEXT");
  if (typeof apiKey !== "string" || !context || typeof context !== "object") {
    throw new Error("YouTube 没有提供可读取的文字稿入口");
  }
  const client = (context as { client?: {
    clientVersion?: string;
    visitorData?: string;
  } }).client;
  const clientName = window.ytcfg?.get?.("INNERTUBE_CONTEXT_CLIENT_NAME");
  const headers: Record<string, string> = {
    "Accept": "*/*",
    "Accept-Language": "*",
    "Content-Type": "application/json",
    "X-Origin": location.origin,
    "X-Youtube-Client-Name": String(clientName ?? 1),
    "X-Youtube-Client-Version": client?.clientVersion ?? ""
  };
  if (client?.visitorData) headers["X-Goog-Visitor-Id"] = client.visitorData;
  await addYouTubeSessionHeaders(headers);

  let nextData: unknown;
  try {
    const nextResponse = await fetchWithTimeout(`/youtubei/v1/next?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true })
    }, 2500);
    if (nextResponse.ok) nextData = await nextResponse.json();
  } catch {
    // Use page data only if it explicitly identifies the requested video.
  }
  const nextVideoId = watchDataVideoId(nextData);
  const sources = [
    nextVideoId && nextVideoId !== videoId ? undefined : nextData,
    ...[watchData, window.ytInitialData].filter((data) => watchDataVideoId(data) === videoId)
  ];
  const params = sources.map((data) => findSearchableTranscriptParams(data) ?? findTranscriptParams(data)).find(Boolean);
  if (!params) throw new Error("YouTube 没有返回当前视频的文字稿入口");

  if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("视频已经切换");
  let response: Response;
  try {
    response = await fetchWithTimeout(`/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ context, params })
    }, 2500);
  } catch {
    throw new Error("YouTube 文字稿接口响应超时");
  }
  if (!response.ok) throw await youtubeResponseError(response);
  const cues = transcriptCuesFromResponse(await response.json());
  if (cues.length === 0) throw new Error("YouTube 文字稿为空");
  if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("视频已经切换");
  return cues;
}

type WatchElement = HTMLElement & { data?: unknown };
const TRANSCRIPT_BUTTON = "ytd-video-description-transcript-section-renderer button:not([disabled])";

function currentNativeWatch(videoId: string): WatchElement | undefined {
  if (new URL(location.href).searchParams.get("v") !== videoId) return;
  const cc = document.querySelector<HTMLButtonElement>("#movie_player .ytp-subtitles-button");
  if (!cc || cc.disabled || cc.getAttribute("aria-disabled") === "true" || cc.getAttribute("aria-pressed") !== "true") return;
  const watch = document.querySelector<WatchElement>("ytd-watch-flexy[video-id]");
  const dataVideoId = watchDataVideoId(watch?.data);
  if (!watch || watch.getAttribute("video-id") !== videoId || (dataVideoId && dataVideoId !== videoId)) return;
  if (getPlayerResponse(videoId)?.videoDetails?.videoId !== videoId) return;
  return watch;
}

function readNativeTranscript(watch: WatchElement, expandedOnly = true): TranscriptCue[] {
  const panels = watch.querySelectorAll("ytd-engagement-panel-section-list-renderer" +
    (expandedOnly ? '[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]' : ""));
  const baseline: TranscriptCue[] = [];
  for (const panel of panels) {
    const modern = Array.from(panel.querySelectorAll("transcript-segment-view-model")).map((row) => ({
      timestamp: row.querySelector(".ytwTranscriptSegmentViewModelTimestamp")?.textContent ?? "",
      text: row.querySelector("span.ytAttributedStringHost")?.textContent ?? ""
    }));
    const rows = modern.length ? modern : Array.from(panel.querySelectorAll("ytd-transcript-segment-renderer")).map((row) => ({
      timestamp: row.querySelector(".segment-timestamp")?.textContent ?? "",
      text: row.querySelector(".segment-text")?.textContent ?? ""
    }));
    const cues = transcriptCuesFromRows(rows);
    if (expandedOnly && cues.length) return cues;
    baseline.push(...cues);
  }
  return baseline;
}

let nativeTranscript: { videoId: string; cues: TranscriptCue[] } | undefined;
const pendingNativeTranscripts = new Map<string, Promise<TranscriptCue[]>>();
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const cueKey = ({ startMs, text }: TranscriptCue) => `${startMs}\0${text}`;

async function fetchNativeTranscript(videoId: string): Promise<TranscriptCue[]> {
  const watch = currentNativeWatch(videoId);
  if (!watch) return [];
  if (nativeTranscript?.videoId === videoId) return nativeTranscript.cues;

  let button = watch.querySelector<HTMLButtonElement>(TRANSCRIPT_BUTTON);
  if (!button) {
    watch.querySelector<HTMLElement>("ytd-watch-metadata #description #expand")?.click();
    const deadline = Date.now() + 1500;
    while (!button && Date.now() < deadline) {
      await pause(100);
      if (currentNativeWatch(videoId) !== watch) return [];
      button = watch.querySelector<HTMLButtonElement>(TRANSCRIPT_BUTTON);
    }
  }
  if (!button) return [];

  // A SPA navigation can leave the previous video's expanded transcript in
  // the current watch element. A click alone does not make those rows current.
  const before = new Set(readNativeTranscript(watch, false).map(cueKey));
  button.click();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && currentNativeWatch(videoId) === watch) {
    const cues = readNativeTranscript(watch);
    if (cues.some((cue) => !before.has(cueKey(cue)))) {
      nativeTranscript = { videoId, cues };
      return cues;
    }
    await pause(120);
  }
  return [];
}

async function fetchTranscript(videoId: string): Promise<TranscriptCue[]> {
  try {
    return await fetchTranscriptFromApi(videoId);
  } catch (error) {
    let pending = pendingNativeTranscripts.get(videoId);
    if (!pending) {
      pending = fetchNativeTranscript(videoId).finally(() => pendingNativeTranscripts.delete(videoId));
      pendingNativeTranscripts.set(videoId, pending);
    }
    const cues = await pending;
    if (cues.length) return cues;
    throw error;
  }
}

document.addEventListener("tubitle:request-transcript", (event) => {
  const detail = (event as CustomEvent<{ requestId?: string; videoId?: string }>).detail;
  if (!detail?.requestId || !detail.videoId) return;
  void fetchTranscript(detail.videoId).then(
    (cues) => document.dispatchEvent(new CustomEvent("tubitle:transcript", {
      detail: { requestId: detail.requestId, videoId: detail.videoId, cues }
    })),
    (error: unknown) => document.dispatchEvent(new CustomEvent("tubitle:transcript", {
      detail: {
        requestId: detail.requestId,
        videoId: detail.videoId,
        error: error instanceof Error ? error.message : "读取 YouTube 文字稿失败"
      }
    }))
  );
});
window.setInterval(publishTracks, 1500);
