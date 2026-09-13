export interface TranscriptCue {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptRow {
  timestamp: string;
  text: string;
}

function timestampToMs(value: string): number | undefined {
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return undefined;
  }
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds * 1000;
}

export function transcriptCuesFromRows(rows: TranscriptRow[]): TranscriptCue[] {
  const timed = rows.flatMap((row) => {
    const startMs = timestampToMs(row.timestamp);
    const text = row.text.replace(/\s+/g, " ").trim();
    return startMs === undefined || !text ? [] : [{ text, startMs }];
  });
  return timed.map((row, index) => {
    const nextStart = timed[index + 1]?.startMs;
    const endMs = nextStart !== undefined && nextStart > row.startMs
      ? nextStart
      : row.startMs + 2000;
    return { ...row, endMs };
  });
}

export function findTranscriptParams(value: unknown, depth = 0): string | undefined {
  if (depth > 18 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTranscriptParams(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  const endpoint = object.getTranscriptEndpoint;
  if (endpoint && typeof endpoint === "object") {
    const params = (endpoint as Record<string, unknown>).params;
    if (typeof params === "string" && params) return params;
  }
  for (const child of Object.values(object)) {
    const found = findTranscriptParams(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function findSearchableTranscriptParams(value: unknown, depth = 0): string | undefined {
  if (depth > 18 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSearchableTranscriptParams(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  const panelIdentifier = object.panelIdentifier ?? object.panel_identifier;
  if (panelIdentifier === "engagement-panel-searchable-transcript") {
    return findTranscriptParams(object);
  }
  for (const child of Object.values(object)) {
    const found = findSearchableTranscriptParams(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function transcriptCuesFromResponse(value: unknown): TranscriptCue[] {
  const result: TranscriptCue[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 24 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const object = node as Record<string, unknown>;
    const renderer = object.transcriptSegmentRenderer;
    if (renderer && typeof renderer === "object") {
      const segment = renderer as Record<string, unknown>;
      const startMs = Number(segment.startMs);
      const endMs = Number(segment.endMs);
      const snippet = segment.snippet as { runs?: Array<{ text?: string }> } | undefined;
      const text = snippet?.runs?.map((run) => run.text ?? "").join("").replace(/\s+/g, " ").trim() ?? "";
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && text) {
        result.push({ text, startMs, endMs });
      }
      return;
    }
    for (const child of Object.values(object)) visit(child, depth + 1);
  };
  visit(value, 0);
  return result.sort((left, right) => left.startMs - right.startMs);
}
