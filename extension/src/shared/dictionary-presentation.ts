import type Mdict from "@tubetitle/mdict-browser";
import { extractDictionaryStyles, sanitizeDictionaryCss } from "./dictionary-sanitize";

const styleCache = new WeakMap<object, Map<string, Promise<string>>>();

export async function loadDictionaryCss(dictionary: Mdict, definition: string, customCss = ""): Promise<string> {
  const { embeddedCss, links } = extractDictionaryStyles(definition);
  const linkedCss = await Promise.all(links.map((link) => loadLinkedStyle(dictionary, link)));
  return [embeddedCss, ...linkedCss, sanitizeDictionaryCss(customCss)].filter(Boolean).join("\n");
}

async function loadLinkedStyle(dictionary: Mdict, link: string): Promise<string> {
  const normalized = normalizeResourceKey(link);
  if (!normalized || hasUnsafeScheme(link)) return "";
  let dictionaryCache = styleCache.get(dictionary);
  if (!dictionaryCache) {
    dictionaryCache = new Map();
    styleCache.set(dictionary, dictionaryCache);
  }
  const cached = dictionaryCache.get(normalized);
  if (cached) return cached;
  const pending = findLinkedStyle(dictionary, link, normalized);
  dictionaryCache.set(normalized, pending);
  return pending;
}

async function findLinkedStyle(dictionary: Mdict, original: string, normalized: string): Promise<string> {
  const decoded = safeDecodeURIComponent(original.split(/[?#]/, 1)[0] ?? original);
  const basename = normalized.split("/").pop() ?? normalized;
  const variants = [...new Set([
    decoded,
    decoded.replace(/^\.\//, ""),
    decoded.replace(/^[/\\]+/, ""),
    decoded.replace(/\//g, "\\"),
    normalized,
    basename
  ].filter(Boolean))];
  for (const query of variants) {
    try {
      const candidates = await dictionary.getWordList(query);
      const exact = candidates.find((candidate) => normalizeResourceKey(candidate.word) === normalized)
        ?? candidates.find((candidate) => normalizeResourceKey(candidate.word) === normalizeResourceKey(basename));
      if (exact) return sanitizeDictionaryCss(await dictionary.getDefinition(exact.offset));
    } catch {
      // Some dictionaries reference a companion MDD or an absent stylesheet.
    }
  }
  return "";
}

function normalizeResourceKey(value: string): string {
  return safeDecodeURIComponent(value)
    .split(/[?#]/, 1)[0]!
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function hasUnsafeScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value) && !value.toLowerCase().startsWith("entry:");
}

function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
