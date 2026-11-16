import { decodeTextEntities } from "../shared/text-entities";
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
  return decodeTextEntities(text).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function removeOverlap(previous: string, next: string): string {
  const words = next.match(/\S+\s*/g) ?? [];
  let length = 0;
  let overlap = 0;
  for (const word of words) {
    length += word.length;
    if (length > 80) break;
    const prefix = next.slice(0, length).trimEnd().toLowerCase();
    const start = previous.length - prefix.length;
    if (prefix.length >= 4 && start >= 0 && (start === 0 || previous[start - 1] === " ") &&
      previous.slice(start).toLowerCase() === prefix) overlap = length;
  }
  return next.slice(overlap);
}

interface PositionedCue extends CaptionCue {
  offset: number;
}

// Preferred size for packing complete sentences; a single sentence may exceed it.
const CAPTION_LENGTH = 120;
const JOIN_GAP_MS = 1400;

function isRollingPrefix(prefix: string, text: string): boolean {
  return text === prefix || (text.startsWith(prefix) && /^[\s.,!?;:。，！？；：]/u.test(text.slice(prefix.length)));
}

function collapseRollingCues(cues: CaptionCue[]): CaptionCue[] {
  const result: CaptionCue[] = [];
  for (const cue of cues) {
    const previous = result.at(-1);
    const current = cue.text.toLowerCase();
    const prior = previous?.text.toLowerCase();
    // Consecutive nonoverlapping cues can be genuine repetition.
    if (previous && prior && cue.startMs < previous.endMs && isRollingPrefix(prior, current)) {
      previous.text = cue.text;
      previous.endMs = Math.max(previous.endMs, cue.endMs);
    } else if (previous && prior && cue.startMs < previous.endMs && isRollingPrefix(current, prior)) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
    } else {
      result.push({ ...cue });
    }
  }
  return result;
}

function isAbbreviation(text: string, period: number): boolean {
  const left = text.slice(Math.max(0, period - 14), period + 1);
  const right = text.slice(period + 1, period + 20);
  return /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e)\.$/i.test(left) ||
    (/\b(?:[A-Za-z]\.){2,}$/.test(left) && /^\s+[a-z]/.test(right)) ||
    (/\b\p{Lu}\.$/u.test(left) && /^\s+\p{Lu}\p{Ll}/u.test(right));
}

function groupCaptionCues(input: CaptionCue[], preferredLength: number): CaptionSentence[] {
  const ordered = input
    .map((cue) => ({ ...cue, text: normalizeText(cue.text), endMs: Math.max(cue.endMs, cue.startMs + 1) }))
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && Boolean(cue.text))
    .sort((left, right) => left.startMs - right.startMs);
  const sentences: CaptionSentence[] = [];
  let block: PositionedCue[] = [];
  let text = "";

  function flushBlock() {
    if (!block.length) return;
    const breaks = new Map(block.map((cue, index) => [cue.offset, cue.startMs - (block[index - 1]?.endMs ?? cue.startMs)]));
    let cueIndex = 0;
    const timeAt = (offset: number) => {
      while (block[cueIndex + 1] && offset >= block[cueIndex + 1]!.offset) cueIndex++;
      const cue = block[cueIndex]!;
      const fraction = Math.min(1, (offset - cue.offset) / cue.text.length);
      const end = block[cueIndex + 1]
        ? Math.min(cue.endMs, block[cueIndex + 1]!.startMs)
        : cue.endMs;
      return cue.startMs + fraction * Math.max(0, end - cue.startMs);
    };
    const emit = (start: number, end: number) => {
      const startMs = timeAt(start);
      const endMs = timeAt(end);
      sentences.push({ id: `${Math.round(startMs)}-${sentences.length}`, text: text.slice(start, end), startMs, endMs: Math.max(startMs + 1, endMs) });
    };
    let captionStart = 0;
    let captionEnd = 0;
    const appendSentence = (start: number, end: number) => {
      if (start >= end) return;
      // Only complete sentence boundaries can end a caption. Length and pauses
      // decide whether the next sentence fits, never where to split a sentence.
      if (captionEnd > captionStart &&
        (end - captionStart > preferredLength || (breaks.get(start) ?? 0) > JOIN_GAP_MS)) {
        emit(captionStart, captionEnd);
        captionStart = start;
      }
      captionEnd = end;
    };
    let start = 0;
    for (const match of text.matchAll(/[.!?。！？]+["”’')\]]*/gu)) {
      const end = match.index + match[0].length;
      if (match[0] === "." && isAbbreviation(text, match.index)) continue;
      if (/^[.!?]/.test(match[0]) && end < text.length && text[end] !== " ") continue;
      appendSentence(start, end);
      start = end + (text[end] === " " ? 1 : 0);
    }
    appendSentence(start, text.length);
    if (captionEnd > captionStart) emit(captionStart, captionEnd);
    block = [];
    text = "";
  }

  for (const cue of collapseRollingCues(ordered)) {
    const previous = block.at(-1);
    const addition = previous && block.length && cue.startMs < previous.endMs
      ? removeOverlap(previous.text, cue.text)
      : cue.text;
    if (!addition) continue;
    const offset = text.length + (text ? 1 : 0);
    block.push({ ...cue, text: addition, offset });
    text += (text ? " " : "") + addition;
  }
  flushBlock();
  return sentences;
}

export function cuesToSentences(input: CaptionCue[]): CaptionSentence[] {
  return groupCaptionCues(input, CAPTION_LENGTH);
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
  return decodeTextEntities(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
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
  if (settings.provider === "hy-mt-local" || shouldSkipTranslation(source.languageCode, settings)) return result;
  const targets = tracks.filter((track) => languageFamily(track.languageCode) === languageFamily(settings.targetLanguage));
  const traditional = /(?:tw|hant|hk)/i.test(settings.targetLanguage);
  const matching = targets.filter((track) => languageFamily(settings.targetLanguage) !== "zh" || /(?:tw|hant|hk)/i.test(track.languageCode) === traditional);
  const target = matching.find((track) => track.kind !== "asr") ?? matching[0];
  if (!target) return result;
  try {
    // Keep target sentences separate for time alignment; packing them can attach
    // the translation of a neighbouring sentence to multiple source captions.
    const translated = groupCaptionCues(await fetchTrackCues(target), 0);
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
