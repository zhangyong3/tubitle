import { describe, expect, it } from "vitest";
import { captionTracksForVideo, type YouTubePlayerResponse } from "./caption-tracks";

const response: YouTubePlayerResponse = {
  videoDetails: { videoId: "old-video" },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{
        baseUrl: "https://www.youtube.com/api/timedtext?v=old-video",
        languageCode: "en",
        name: { simpleText: "English" }
      }]
    }
  }
};

describe("captionTracksForVideo", () => {
  it("rejects a stale track left over from the previous SPA video", () => {
    expect(captionTracksForVideo(response, "new-video")).toEqual([]);
  });

  it("returns tracks only when the player response belongs to the current video", () => {
    expect(captionTracksForVideo(response, "old-video")).toEqual([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=old-video",
      languageCode: "en",
      name: "English",
      kind: undefined,
      isTranslatable: undefined
    }]);
  });
});
