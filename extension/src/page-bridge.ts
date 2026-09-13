import { captionTracksForVideo, type YouTubePlayerResponse } from "./shared/caption-tracks";
import {
  findSearchableTranscriptParams,
  findTranscriptParams,
  transcriptCuesFromRows,
  transcriptCuesFromResponse
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

function readNativeTranscript() {
  const expandedPanels = Array.from(document.querySelectorAll<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]'
  ));
  const modernPanel = expandedPanels.find((panel) => panel.querySelector("transcript-segment-view-model"));
  const classicPanel = expandedPanels.find((panel) => panel.querySelector("ytd-transcript-segment-renderer"));
  const modernSegments = modernPanel
    ? Array.from(modernPanel.querySelectorAll("transcript-segment-view-model"))
    : [];
  const rows = modernSegments.length > 0
    ? modernSegments.map((segment) => ({
      timestamp: segment.querySelector(".ytwTranscriptSegmentViewModelTimestamp")?.textContent ?? "",
      text: segment.querySelector("span.ytAttributedStringHost")?.textContent ?? ""
    }))
    : Array.from(classicPanel?.querySelectorAll("ytd-transcript-segment-renderer") ?? []).map((segment) => ({
      timestamp: segment.querySelector(".segment-timestamp")?.textContent ?? "",
      text: segment.querySelector(".segment-text")?.textContent ?? ""
    }));
  return transcriptCuesFromRows(rows);
}

async function fetchNativeTranscript(videoId: string) {
  const startedAt = Date.now();
  let button = document.querySelector<HTMLButtonElement>(
    "ytd-video-description-transcript-section-renderer button:not([disabled])"
  );
  if (!button) {
    document.querySelector<HTMLElement>("ytd-watch-metadata #description #expand")?.click();
    while (!button && Date.now() - startedAt < 1500) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      button = document.querySelector<HTMLButtonElement>(
        "ytd-video-description-transcript-section-renderer button:not([disabled])"
      );
    }
  }
  button?.click();

  while (Date.now() - startedAt < 15_000) {
    if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("视频已经切换");
    const cues = readNativeTranscript();
    if (cues.length > 0) return cues;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  throw new Error(button ? "YouTube 页面文字稿加载超时" : "YouTube 页面没有文字稿入口");
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

async function fetchTranscriptFromApi(videoId: string) {
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

  let nextResponse: Response | undefined;
  try {
    nextResponse = await fetchWithTimeout(`/youtubei/v1/next?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true })
    }, 2500);
  } catch {
    // The page data below may already contain a usable transcript endpoint.
  }
  let nextData: unknown;
  if (nextResponse?.ok) nextData = await nextResponse.json();
  let params = findSearchableTranscriptParams(nextData)
    ?? findSearchableTranscriptParams(watchData)
    ?? findSearchableTranscriptParams(window.ytInitialData);
  params ??= findTranscriptParams(nextData)
    ?? findTranscriptParams(watchData)
    ?? findTranscriptParams(window.ytInitialData);
  if (!params) throw new Error("YouTube 没有返回当前视频的文字稿入口");

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
  return cues;
}

async function fetchTranscript(videoId: string) {
  let apiError: Error | undefined;
  let cues: ReturnType<typeof transcriptCuesFromResponse> = [];
  try {
    cues = await fetchTranscriptFromApi(videoId);
  } catch (error) {
    apiError = error instanceof Error ? error : new Error("读取 YouTube 文字稿失败");
  }
  if (cues.length === 0) {
    try {
      cues = await fetchNativeTranscript(videoId);
    } catch (nativeError) {
      const nativeMessage = nativeError instanceof Error ? nativeError.message : "读取页面文字稿失败";
      throw new Error(`${apiError?.message ?? "读取 YouTube 文字稿失败"}；页面回退失败：${nativeMessage}`);
    }
  }
  if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("视频已经切换");
  return cues;
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
