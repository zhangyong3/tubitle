import { describe, expect, it } from "vitest";
import {
  findSearchableTranscriptParams,
  findTranscriptParams,
  transcriptCuesFromRows,
  transcriptCuesFromResponse
} from "./youtube-transcript";

describe("YouTube transcript helpers", () => {
  it("finds the transcript endpoint inside watch page data", () => {
    expect(findTranscriptParams({ engagementPanels: [{ content: {
      continuationEndpoint: { getTranscriptEndpoint: { params: "encoded-params" } }
    } }] })).toBe("encoded-params");
  });

  it("selects params from the searchable transcript panel", () => {
    const response = { engagementPanels: [
      { engagementPanelSectionListRenderer: {
        panelIdentifier: "engagement-panel-comments-section",
        content: { getTranscriptEndpoint: { params: "wrong-params" } }
      } },
      { engagementPanelSectionListRenderer: {
        panelIdentifier: "engagement-panel-searchable-transcript",
        content: {
          continuationItemRenderer: {
            continuationEndpoint: { getTranscriptEndpoint: { params: "current-video-params" } }
          }
        }
      } }
    ] };
    expect(findSearchableTranscriptParams(response)).toBe("current-video-params");
  });

  it("extracts and orders timed transcript segments", () => {
    const response = { actions: [{ content: { initialSegments: [
      { transcriptSegmentRenderer: { startMs: "1200", endMs: "2200", snippet: { runs: [{ text: "Second." }] } } },
      { transcriptSegmentRenderer: { startMs: "0", endMs: "1200", snippet: { runs: [{ text: "Welcome " }, { text: "back." }] } } }
    ] } }] };
    expect(transcriptCuesFromResponse(response)).toEqual([
      { text: "Welcome back.", startMs: 0, endMs: 1200 },
      { text: "Second.", startMs: 1200, endMs: 2200 }
    ]);
  });

  it("converts YouTube's visible transcript rows into timed cues", () => {
    expect(transcriptCuesFromRows([
      { timestamp: "0:01", text: " Welcome back. " },
      { timestamp: "1:02:03", text: "A long lesson." }
    ])).toEqual([
      { text: "Welcome back.", startMs: 1000, endMs: 3_723_000 },
      { text: "A long lesson.", startMs: 3_723_000, endMs: 3_725_000 }
    ]);
  });
});
