import { languageFamily, shouldSkipTranslation } from "../shared/languages";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { ExtensionSettings } from "../shared/types";
import type { CaptionSentence, CaptionTrack } from "../shared/types";

interface Json3Segment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Segment[];
}

interface Json3Payload {
  events?: Json3Event[];
}

interface CaptionCue {
  text: string;
  startMs: number;
  endMs: number;
}

export interface BilingualCaptions {
  sourceLanguage?: string;
  sentences: CaptionSentence[];
  officialTranslations: Map<string, string>;
}

function normalizeText(text: string): string {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function removeOverlap(previous: string, next: string): string {
  const max = Math.min(previous.length, next.length, 80);
  for (let length = max; length >= 4; length -= 1) {
    const suffix = previous.slice(-length).toLowerCase();
    const prefix = next.slice(0, length).toLowerCase();
    if (suffix === prefix) return next.slice(length).trimStart();
  }
  return next;
}

function collapseRollingCues(cues: CaptionCue[]): CaptionCue[] {
  const result: CaptionCue[] = [];
  for (const cue of cues) {
    const previous = result.at(-1);
    if (!previous) {
      result.push({ ...cue });
      continue;
    }
    const previousLower = previous.text.toLowerCase();
    const currentLower = cue.text.toLowerCase();
    const nearby = cue.startMs <= previous.endMs + 1500;
    if (nearby && currentLower.startsWith(previousLower)) {
      previous.text = cue.text;
      previous.endMs = Math.max(previous.endMs, cue.endMs);
    } else if (nearby && previousLower.startsWith(currentLower)) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
    } else if (previousLower === currentLower) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
    } else {
      result.push({ ...cue });
    }
  }
  return result;
}

function splitCue(cue: CaptionCue): CaptionCue[] {
  const parts = cue.text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map(normalizeText) ?? [];
  if (parts.length <= 1) return [cue];
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const duration = Math.max(1, cue.endMs - cue.startMs);
  let consumedLength = 0;
  return parts.map((text, index) => {
    const startMs = cue.startMs + (duration * consumedLength) / totalLength;
    consumedLength += text.length;
    const endMs = index === parts.length - 1
      ? Math.max(cue.endMs, startMs + 1)
      : cue.startMs + (duration * consumedLength) / totalLength;
    return { text, startMs, endMs: Math.max(endMs, startMs + 1) };
  });
}

export function cuesToSentences(input: CaptionCue[]): CaptionSentence[] {
  const ordered = input
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && Boolean(normalizeText(cue.text)))
    .map((cue) => ({ ...cue, text: normalizeText(cue.text), endMs: Math.max(cue.endMs, cue.startMs + 1) }))
    .sort((left, right) => left.startMs - right.startMs);
  const cues = collapseRollingCues(ordered).flatMap(splitCue);
  const sentences: CaptionSentence[] = [];
  let buffer: CaptionCue | undefined;

  const flush = (): void => {
    if (!buffer?.text) return;
    sentences.push({
      id: `${Math.round(buffer.startMs)}-${sentences.length}`,
      text: normalizeText(buffer.text),
      startMs: buffer.startMs,
      endMs: Math.max(buffer.endMs, buffer.startMs + 1)
    });
    buffer = undefined;
  };

  for (const cue of cues) {
    if (!buffer) {
      buffer = { ...cue };
    } else {
      const gap = cue.startMs - buffer.endMs;
      const complete = /[.!?]["')\]]*$/.test(buffer.text);
      const tooLong = buffer.text.length >= 180 || buffer.endMs - buffer.startMs >= 12_000;
      if (complete || gap > 1400 || tooLong) {
        flush();
        buffer = { ...cue };
      } else {
        const addition = removeOverlap(buffer.text, cue.text);
        buffer.text = normalizeText(`${buffer.text} ${addition}`);
        buffer.endMs = Math.max(buffer.endMs, cue.endMs);
      }
    }
  }
  flush();
  return sentences;
}

function json3Cues(body: string): CaptionCue[] | undefined {
  let json: Json3Payload;
  try {
    json = JSON.parse(body) as Json3Payload;
  } catch {
    return undefined;
  }
  return (json.events ?? []).flatMap((event) => {
    const text = normalizeText(event.segs?.map((segment) => segment.utf8 ?? "").join("") ?? "");
    if (!text || event.tStartMs === undefined) return [];
    const duration = event.dDurationMs ?? 2000;
    return [{ text, startMs: event.tStartMs, endMs: event.tStartMs + duration }];
  });
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attribute(value: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(value)?.[1];
}

function xmlCues(body: string): CaptionCue[] | undefined {
  if (!/^\s*</.test(body)) return undefined;
  const result: CaptionCue[] = [];
  for (const match of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const start = Number(attribute(match[1] ?? "", "t"));
    const duration = Number(attribute(match[1] ?? "", "d") ?? 2000);
    const text = normalizeText(decodeXmlText(match[2] ?? ""));
    if (Number.isFinite(start) && text) result.push({ text, startMs: start, endMs: start + Math.max(1, duration) });
  }
  if (result.length > 0) return result;
  for (const match of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const start = Number(attribute(match[1] ?? "", "start")) * 1000;
    const duration = Number(attribute(match[1] ?? "", "dur") ?? 2) * 1000;
    const text = normalizeText(decodeXmlText(match[2] ?? ""));
    if (Number.isFinite(start) && text) result.push({ text, startMs: start, endMs: start + Math.max(1, duration) });
  }
  return result;
}

async function fetchTrackCues(track: CaptionTrack): Promise<CaptionCue[]> {
  const jsonUrl = new URL(track.baseUrl);
  jsonUrl.searchParams.set("fmt", "json3");
  const candidates = [track.baseUrl];
  if (jsonUrl.toString() !== track.baseUrl) candidates.push(jsonUrl.toString());
  let lastStatus: number | undefined;
  let receivedBody = false;
  for (const candidate of candidates) {
    const response = await fetch(candidate, { credentials: "include" });
    lastStatus = response.status;
    if (!response.ok) continue;
    const body = await response.text();
    if (!body.trim()) continue;
    receivedBody = true;
    const cues = json3Cues(body) ?? xmlCues(body);
    if (cues && cues.length > 0) return cues;
  }
  if (lastStatus !== undefined && (lastStatus < 200 || lastStatus >= 300)) {
    throw new Error(`读取字幕失败 (${lastStatus})`);
  }
  if (!receivedBody) throw new Error("字幕服务返回了空响应，请刷新视频页面后重试");
  throw new Error("字幕数据格式异常，请刷新视频页面后重试");
}

export async function fetchEnglishSentences(
  tracks: CaptionTrack[]
): Promise<CaptionSentence[]> {
  const englishTracks = tracks.filter((track) => /^en(?:-|$)/i.test(track.languageCode));
  const track = englishTracks.find((item) => item.kind !== "asr") ?? englishTracks[0];
  if (!track) throw new Error("这个视频没有可用的英文字幕");
  const sentences = cuesToSentences(await fetchTrackCues(track));
  if (sentences.length === 0) throw new Error("字幕轨道为空");
  return sentences;
}

export function selectSourceTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const english = tracks.filter((track) => /^en(?:-|$)/i.test(track.languageCode));
  return english.find((track) => track.kind !== "asr") ?? english[0] ?? tracks.find((track) => track.kind === "asr") ?? tracks[0];
}

export async function fetchBilingualCaptions(tracks: CaptionTrack[], settings: ExtensionSettings = DEFAULT_SETTINGS): Promise<BilingualCaptions> {
  const source = selectSourceTrack(tracks);
  if (!source) throw new Error("这个视频没有可用的字幕");
  const sentences = cuesToSentences(await fetchTrackCues(source));
  if (!sentences.length) throw new Error("字幕轨道为空");
  const officialTranslations = new Map<string, string>();
  const result = { sentences, officialTranslations, sourceLanguage: source.languageCode };
  if (shouldSkipTranslation(source.languageCode, settings)) return result;
  const targets = tracks.filter((track) => languageFamily(track.languageCode) === languageFamily(settings.targetLanguage));
  const traditional = /(?:tw|hant|hk)/i.test(settings.targetLanguage);
  const matching = targets.filter((track) => languageFamily(settings.targetLanguage) !== "zh" || /(?:tw|hant|hk)/i.test(track.languageCode) === traditional);
  const target = matching.find((track) => track.kind !== "asr") ?? matching[0];
  if (!target) return result;
  try {
    const translated = cuesToSentences(await fetchTrackCues(target));
    for (const sentence of sentences) {
      const matches = translated.filter((candidate) => candidate.startMs < sentence.endMs + 400 && candidate.endMs > sentence.startMs - 400);
      const text = matches.map((candidate) => candidate.text).join(" ").replace(/\s+/g, " ").trim();
      if (text) officialTranslations.set(sentence.id, text);
    }
  } catch {
    // An optional target track must not prevent the source captions from working.
  }
  return result;
}
