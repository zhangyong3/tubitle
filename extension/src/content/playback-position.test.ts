import { expect, it } from "vitest";
import { CaptionPlaybackPosition } from "./playback-position";

function player(currentTime = 0) {
  return { currentTime, duration: 1800, seeking: false, readyState: 4 };
}

it.each(["t=1223s", "t=1223", "t=20m23s", "start=1223", "#t=20m23s"])(
  "waits for the linked position with %s", (parameter) => {
    const position = new CaptionPlaybackPosition();
    position.reset(`https://www.youtube.com/watch?v=test${parameter.startsWith("#") ? "" : "&"}${parameter}`);
    const video = player();
    expect(position.ready(video, 0, false)).toBe(false);
    video.currentTime = 1223;
    expect(position.ready(video, 100, false)).toBe(false);
    expect(position.ready(video, 400, false)).toBe(true);
    // Once startup has settled, the old URL timestamp must not constrain later seeks.
    video.currentTime = 0;
    expect(position.ready(video, 500, false)).toBe(true);
  }
);

it("rejects ad and buffering times and restarts settling after another seek", () => {
  const position = new CaptionPlaybackPosition();
  position.reset("https://www.youtube.com/watch?v=test&t=1223s");
  const video = player(1223);
  expect(position.ready(video, 0, true)).toBe(false);
  video.readyState = 0;
  expect(position.ready(video, 100, false)).toBe(false);
  video.readyState = 4;
  expect(position.ready(video, 200, false)).toBe(false);
  video.seeking = true;
  expect(position.ready(video, 500, false)).toBe(false);
  video.seeking = false;
  expect(position.ready(video, 600, false)).toBe(false);
  expect(position.ready(video, 900, false)).toBe(true);
});

it("does not count a long ad toward the fallback timeout", () => {
  const position = new CaptionPlaybackPosition();
  position.reset("https://www.youtube.com/watch?v=test&t=1223s");
  const video = player();
  expect(position.ready(video, 0, false)).toBe(false);
  expect(position.ready(video, 100, true)).toBe(false);
  expect(position.ready(video, 30_000, false)).toBe(false);
  expect(position.ready(video, 30_300, false)).toBe(false);
  video.currentTime = 1223;
  expect(position.ready(video, 31_000, false)).toBe(false);
  expect(position.ready(video, 31_300, false)).toBe(true);
});

it("does not wait forever when YouTube ignores a timestamp, or when it exceeds the duration", () => {
  const position = new CaptionPlaybackPosition();
  position.reset("https://www.youtube.com/watch?v=test&t=1223s");
  const video = player();
  expect(position.ready(video, 0, false)).toBe(false);
  expect(position.ready(video, 10_000, false)).toBe(false);
  expect(position.ready(video, 10_300, false)).toBe(true);
  position.reset("https://www.youtube.com/watch?v=other&t=99999s");
  video.currentTime = video.duration;
  expect(position.ready(video, 11_000, false)).toBe(false);
  expect(position.ready(video, 11_300, false)).toBe(true);
});

it.each(["", "&t=0", "&t=invalid", "&t=-20"])("starts ordinary links immediately: %s", (parameter) => {
  const position = new CaptionPlaybackPosition();
  position.reset(`https://www.youtube.com/watch?v=test${parameter}`);
  expect(position.ready(player(), 0, false)).toBe(true);
});
