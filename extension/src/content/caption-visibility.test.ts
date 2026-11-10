import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/settings";

const fixture = vi.hoisted(() => ({
  setPanelVisible: vi.fn(),
  setPlaybackActive: vi.fn(),
  setSnapshot: vi.fn(),
  setTranslation: vi.fn(),
  openTab: vi.fn(),
  fetchCaptions: vi.fn(),
  setCaptionsVisible: vi.fn(),
  sendTranslation: vi.fn(),
  sentences: [
    { id: "one", text: "This is the first sentence.", startMs: 0, endMs: 1000 },
    { id: "two", text: "This is the next sentence.", startMs: 1000, endMs: 2000 }
  ]
}));

vi.mock("./overlay", () => ({
  SubtitleOverlay: class {
    setCaptionsVisible = fixture.setCaptionsVisible;
    setEnabled() {}
    setChineseVisible() {}
    setAppearance() {}
    setPosition() {}
    hideSentence() {}
    clearStatus() {}
    showStatus() {}
    attachTo() {}
    updateVideoBounds() {}
    showSentence() {}
    showTranslation() {}
  }
}));
vi.mock("./learning-panel", () => ({
  PageLearningPanel: class {
    setVisible = fixture.setPanelVisible;
    setPlaybackActive = fixture.setPlaybackActive;
    setSnapshot = fixture.setSnapshot;
    openTab = fixture.openTab;
    setActive() {}
    setTranslation = fixture.setTranslation;
    updateLayout() {}
  }
}));
vi.mock("./captions", async (importOriginal) => ({
  ...await importOriginal<typeof import("./captions")>(),
  fetchBilingualCaptions: fixture.fetchCaptions
}));
vi.mock("../shared/subtitle-translation", () => ({ requestSubtitleTranslation: fixture.sendTranslation }));

afterEach(() => vi.unstubAllGlobals());

const captions = () => ({ sentences: fixture.sentences, officialTranslations: new Map(), sourceLanguage: "en" });

async function openFixture() {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.fetchCaptions.mockImplementation(async () => captions());
  let pressed = "false";
  const video = {
    currentTime: 0.5, duration: 2, paused: true, ended: false, seeking: false,
    playbackRate: 1, readyState: 4, HAVE_FUTURE_DATA: 3,
    pause: vi.fn(() => { video.paused = true; }),
    closest: vi.fn(() => null),
    getBoundingClientRect: () => ({})
  };
  const button = { disabled: false, getAttribute: (name: string) => name === "aria-pressed" ? pressed : null };
  const document = Object.assign(new EventTarget(), {
    title: "Test video",
    createElement: () => ({ isConnected: false, remove() {} }),
    documentElement: { append() {} },
    querySelector: (selector: string) => selector.includes("ytp-subtitles-button") ? button :
      selector.startsWith("video") ? video : null
  });
  let nextFrame: FrameRequestCallback;
  const tick = () => nextFrame(250);
  fixture.sendTranslation.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  const location = new URL("https://www.youtube.com/watch?v=test");
  vi.stubGlobal("location", location);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("chrome", { storage: {
    local: { get: async () => ({ settings: DEFAULT_SETTINGS }) },
    onChanged: { addListener() {} }
  } });
  await import("./index");
  await vi.waitFor(() => expect(nextFrame).toBeTypeOf("function"));
  const publishTracks = (url = location.href) =>
    document.dispatchEvent(new CustomEvent("tubetitle:tracks", { detail: { tracks: [], url } }));
  publishTracks();
  await vi.waitFor(() => expect(fixture.setSnapshot).toHaveBeenLastCalledWith(
    expect.objectContaining({ sentences: expect.arrayContaining([expect.objectContaining({ id: "one" })]) })
  ));
  const endPlayback = () => {
    video.currentTime = video.duration;
    video.ended = true;
    const event = new Event("ended");
    // Simulate the document's capture listener seeing a media event from its video.
    Object.defineProperty(event, "target", { value: video });
    document.dispatchEvent(event);
  };
  return { tick, location, document, video, button, publishTracks, endPlayback, setPressed: (value: string) => { pressed = value; } };
}

it("follows the native CC button and gates subtitle translation until CC is on", async () => {
  const { tick, video, setPressed } = await openFixture();
  tick();
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(false);
  expect(fixture.sendTranslation).not.toHaveBeenCalled();

  setPressed("true");
  tick();
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(true);
  expect(fixture.sendTranslation).toHaveBeenCalledWith(expect.objectContaining({ text: fixture.sentences[0]!.text }), expect.any(AbortSignal));
  const activeSignal = fixture.sendTranslation.mock.calls[0]![1] as AbortSignal;

  setPressed("false");
  video.currentTime = 1.5;
  fixture.sendTranslation.mockClear();
  tick();
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(false);
  expect(activeSignal.aborted).toBe(true);
  expect(fixture.sendTranslation).not.toHaveBeenCalled();

  setPressed("true");
  tick();
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(true);
  expect(fixture.sendTranslation).toHaveBeenCalledWith(expect.objectContaining({ text: fixture.sentences[1]!.text }), expect.any(AbortSignal));
});

it("only reports normal playback to the panel while captions are on", async () => {
  const { tick, video, setPressed } = await openFixture();
  video.paused = false;
  tick();
  expect(fixture.setPlaybackActive).toHaveBeenLastCalledWith(false);

  setPressed("true");
  tick();
  expect(fixture.setPlaybackActive).toHaveBeenLastCalledWith(true);

  video.readyState = 2;
  tick();
  expect(fixture.setPlaybackActive).toHaveBeenLastCalledWith(false);

  video.readyState = 4;
  video.seeking = true;
  tick();
  expect(fixture.setPlaybackActive).toHaveBeenLastCalledWith(false);

  video.seeking = false;
  video.pause();
  tick();
  expect(fixture.setPlaybackActive).toHaveBeenLastCalledWith(false);
});

it("publishes a prefetched translation while the video is still paused on the previous sentence", async () => {
  const { tick, video, setPressed } = await openFixture();
  fixture.sendTranslation.mockImplementation((request) => request.priority === "prefetch"
    ? Promise.resolve("这是下一句。") : new Promise(() => {}));
  setPressed("true");
  tick();
  await vi.waitFor(() => expect(fixture.setTranslation).toHaveBeenCalledWith("two", "这是下一句。"));
  expect(video.paused).toBe(true);
  expect(video.currentTime).toBeLessThan(fixture.sentences[1]!.startMs / 1000);
});

it("stays on the finished video and opens its exportable transcript at the end of playback", async () => {
  const { tick, location, document, video, button, endPlayback, setPressed } = await openFixture();
  setPressed("true");
  video.paused = false;
  tick();
  document.addEventListener("ended", () => { location.search = "?v=next"; }, true);

  endPlayback();
  button.disabled = true;
  tick();

  expect(location.search).toBe("?v=test");
  expect(video.paused).toBe(true);
  expect(fixture.openTab).toHaveBeenCalledWith("subtitles");
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(true);
  expect(fixture.setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
    videoId: "test", loading: false, error: undefined,
    sentences: fixture.sentences.map((sentence) => expect.objectContaining(sentence))
  }));

  location.search = "?v=manual";
  document.dispatchEvent(new Event("yt-navigate-finish"));
  tick();
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(false);
  expect(fixture.setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: "manual", sentences: [] }));
});

it("leaves native playback alone when captions were turned off", async () => {
  const { tick, document, endPlayback, setPressed } = await openFixture();
  const nativeEnded = vi.fn();
  document.addEventListener("ended", nativeEnded, true);
  setPressed("true");
  tick();
  setPressed("false");
  tick();

  endPlayback();
  tick();

  expect(nativeEnded).toHaveBeenCalledOnce();
  expect(fixture.openTab).not.toHaveBeenCalled();
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(false);
});

it("clears previous captions on SPA navigation before the new track list arrives", async () => {
  const { tick, location, document, button, publishTracks, setPressed } = await openFixture();
  setPressed("true");
  tick();
  const oldSignal = fixture.sendTranslation.mock.calls[0]![1] as AbortSignal;
  const oldUrl = location.href;

  location.search = "?v=no-captions";
  button.disabled = true;
  document.dispatchEvent(new Event("yt-navigate-finish"));
  expect(fixture.setSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
    videoId: "no-captions", sentences: [], activeIndex: -1
  }));
  expect(oldSignal.aborted).toBe(true);

  fixture.sendTranslation.mockClear();
  publishTracks(oldUrl);
  tick();
  expect(fixture.fetchCaptions).toHaveBeenCalledTimes(1);
  expect(fixture.setPanelVisible).toHaveBeenLastCalledWith(false);
  expect(fixture.sendTranslation).not.toHaveBeenCalled();
});

it("discards a previous video's caption download that finishes after the URL changes", async () => {
  const { location, publishTracks } = await openFixture();
  let finish!: (result: ReturnType<typeof captions>) => void;
  fixture.fetchCaptions.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  publishTracks();
  const published = fixture.setSnapshot.mock.calls.length;
  location.search = "?v=no-captions";
  finish(captions());
  await Promise.resolve();
  expect(fixture.setSnapshot).toHaveBeenCalledTimes(published);
});

it("retries a failed caption load when CC is opened and translates the recovered transcript", async () => {
  const { tick, document, publishTracks, button, setPressed } = await openFixture();
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    fixture.fetchCaptions.mockRejectedValue(new Error("Timed text is unavailable"));
    document.addEventListener("tubitle:request-transcript", (event) => {
      const detail = (event as CustomEvent).detail;
      document.dispatchEvent(new CustomEvent("tubitle:transcript", { detail: {
        ...detail,
        ...(button.getAttribute("aria-pressed") === "true"
          ? { cues: [{ startMs: 0, endMs: 2000, text: "A recovered subtitle." }] }
          : { error: "Transcript panel is unavailable while CC is off" })
      } }));
    });
    publishTracks();
    await vi.waitFor(() => expect(fixture.setSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ loading: false, sentences: [], error: expect.any(String) })
    ));
    expect(fixture.sendTranslation).not.toHaveBeenCalled();

    setPressed("true");
    tick();
    await vi.waitFor(() => expect(fixture.setSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ loading: false, sentences: [expect.objectContaining({ text: "A recovered subtitle." })] })
    ));
    tick();
    expect(fixture.sendTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ text: "A recovered subtitle." }), expect.any(AbortSignal)
    );
  } finally {
    consoleWarn.mockRestore();
  }
});
