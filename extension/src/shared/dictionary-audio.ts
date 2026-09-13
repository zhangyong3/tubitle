import Mdict from "@tubetitle/mdict-browser";

export interface PreparedDictionaryAudio {
  html: string;
  urls: string[];
  missing: number;
}

export async function prepareDictionaryAudio(html: string, dictionaries: Mdict[]): Promise<PreparedDictionaryAudio> {
  const documentValue = new DOMParser().parseFromString(`<div id="audio-source">${html}</div>`, "text/html");
  const source = documentValue.getElementById("audio-source");
  if (!source) return { html, urls: [], missing: 0 };
  const elements = [...source.querySelectorAll<HTMLElement>("[data-sound]")];
  const paths = [...new Set(elements.map((element) => element.dataset.sound?.trim() ?? "").filter(Boolean))];
  const resolved = new Map<string, string>();
  const urls: string[] = [];
  let missing = 0;
  for (const path of paths) {
    const bytes = await findAudioResource(dictionaries, path);
    if (!bytes) {
      missing += 1;
      continue;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: audioMimeType(path) }));
    resolved.set(path, url);
    urls.push(url);
  }
  for (const element of elements) {
    const path = element.dataset.sound?.trim() ?? "";
    const url = resolved.get(path);
    if (url) element.dataset.audioUrl = url;
    element.setAttribute("role", "button");
    element.setAttribute("title", url ? "播放发音" : "未找到发音资源，请检查 MDD 文件");
  }
  return { html: source.innerHTML, urls, missing };
}

async function findAudioResource(dictionaries: Mdict[], path: string): Promise<ArrayBuffer | undefined> {
  const normalized = path.replace(/^(?:sound|audio):\/\//i, "").replace(/^[/\\]+/, "");
  const variants = [...new Set([
    normalized,
    normalized.replace(/\//g, "\\"),
    safeDecodeURIComponent(normalized)
  ].filter(Boolean))];
  for (const dictionary of dictionaries) {
    for (const variant of variants) {
      try {
        const resource = await dictionary.getWordList(variant) as unknown;
        if (resource instanceof ArrayBuffer) return resource;
        if (ArrayBuffer.isView(resource)) {
          return resource.buffer.slice(resource.byteOffset, resource.byteOffset + resource.byteLength) as ArrayBuffer;
        }
      } catch {
        // Continue through MDD volumes and path variants.
      }
    }
  }
  return undefined;
}

export function audioMimeType(path: string): string {
  const extension = path.toLowerCase().split(/[?#]/, 1)[0]!.split(".").pop();
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg" || extension === "oga" || extension === "spx") return "audio/ogg";
  if (extension === "opus") return "audio/opus";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "aac") return "audio/aac";
  return "audio/mpeg";
}

function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
