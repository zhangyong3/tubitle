import type {
  TranscriptPanelFrameMessage,
  TranscriptPanelHostMessage,
  TranscriptPanelSnapshot,
  TranscriptPanelTab
} from "../shared/types";

interface LearningPanelHandlers {
  onSeek: (index: number) => void;
  onStudy: (videoId: string, sentenceId: string) => void;
  onPrefetch: (indexes: number[]) => void;
}

const PANEL_MIN_WIDTH = 320;
const PANEL_OVERLAY_MAX_WIDTH = 420;
const REVIEW_MIN_HEIGHT = 240;
const EDGE_GAP = 12;

const HOST_STYLES = `
  :host{all:initial;position:fixed;z-index:2147483645;display:none;font-family:Inter,system-ui,-apple-system,"PingFang SC",sans-serif}
  *{box-sizing:border-box}.frame{display:block;width:100%;height:100%;border:0;border-radius:13px;background:#111219;box-shadow:0 14px 38px rgba(0,0,0,.34)}
  .launcher{display:none;align-items:center;gap:7px;min-height:42px;border:1px solid rgba(255,255,255,.18);border-radius:22px;padding:8px 13px;background:#201b31;color:#c5b9ff;font:600 13px/1 Inter,system-ui,-apple-system,"PingFang SC",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.34);cursor:pointer}
  .launcher:hover{background:#302650;color:#fff}.launcher svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  :host(.launcher-only){width:auto!important;height:auto!important}:host(.launcher-only) .frame{display:none}:host(.launcher-only) .launcher{display:flex}
`;

function launcherIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", "M4 5.5h16v11H9l-5 3v-14Zm4 4h8M8 13h5");
  svg.append(path);
  return svg;
}

export class PageLearningPanel {
  private readonly host = document.createElement("div");
  private readonly frame = document.createElement("iframe");
  private readonly launcher = document.createElement("button");
  private snapshot?: TranscriptPanelSnapshot;
  private pendingTab?: TranscriptPanelTab;
  private pendingWord?: string;
  private frameReady = false;
  private visible = false;
  private playbackActive = false;
  private manuallyCollapsed = false;
  private forcedOverlay = false;
  private lastBounds?: DOMRect;
  private keepInView = false;

  constructor(private readonly handlers: LearningPanelHandlers) {
    this.host.id = "tubitle-learning-panel-host";
    const root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = HOST_STYLES;
    root.append(style);

    this.frame.className = "frame";
    this.frame.src = chrome.runtime.getURL("sidepanel.html?embedded=1");
    this.frame.title = "Tubitle 学习面板";

    this.launcher.className = "launcher";
    this.launcher.type = "button";
    this.launcher.append(launcherIcon(), document.createTextNode("字幕"));
    this.launcher.addEventListener("click", () => {
      this.manuallyCollapsed = false;
      this.forcedOverlay = true;
      this.applyLayout();
      this.openTab("subtitles");
    });
    root.append(this.frame, this.launcher);
    document.documentElement.append(this.host);
    window.addEventListener("message", this.onMessage);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.host.style.display = visible ? "block" : "none";
    if (!visible) {
      this.setPlaybackActive(false);
      this.forcedOverlay = false;
      this.host.classList.remove("launcher-only");
    }
  }

  setPlaybackActive(playing: boolean): void {
    const active = playing && this.visible && !this.host.classList.contains("launcher-only");
    if (active === this.playbackActive) return;
    this.playbackActive = active;
    this.post({ source: "tubitle-host", type: "PANEL_PLAYBACK", playing: active });
  }

  updateLayout(bounds: DOMRect, keepInView = false): void {
    this.lastBounds = bounds;
    this.keepInView = keepInView;
    this.applyLayout();
  }

  setSnapshot(snapshot: TranscriptPanelSnapshot): void {
    this.snapshot = snapshot;
    this.post({ source: "tubitle-host", type: "TRANSCRIPT_STATE", state: snapshot });
  }

  setActive(activeIndex: number, currentTimeMs: number, durationMs: number): void {
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, activeIndex, currentTimeMs, durationMs };
    }
    this.post({ source: "tubitle-host", type: "TRANSCRIPT_ACTIVE", activeIndex, currentTimeMs, durationMs });
  }

  setTranslation(sentenceId: string, translation?: string, error?: string): void {
    if (this.snapshot) {
      this.snapshot = {
        ...this.snapshot,
        sentences: this.snapshot.sentences.map((sentence) => sentence.id === sentenceId
          ? { ...sentence, translation, translationError: error }
          : sentence)
      };
    }
    this.post({ source: "tubitle-host", type: "TRANSCRIPT_TRANSLATION", sentenceId, translation, error });
  }

  studyTranslation(result: Omit<Extract<TranscriptPanelHostMessage, { type: "STUDY_TRANSLATION" }>, "type" | "source">): void {
    this.post({ source: "tubitle-host", type: "STUDY_TRANSLATION", ...result });
  }

  openTab(tab: TranscriptPanelTab): void {
    this.pendingTab = tab;
    this.manuallyCollapsed = false;
    this.forcedOverlay = true;
    this.applyLayout();
    this.post({ source: "tubitle-host", type: "OPEN_PANEL_TAB", tab });
  }

  lookupWord(word: string): void {
    this.openTab("dictionary");
    if (this.frameReady) this.post({ source: "tubitle-host", type: "LOOKUP_WORD", word });
    else this.pendingWord = word;
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage);
    this.host.remove();
  }

  private readonly onMessage = (event: MessageEvent<TranscriptPanelFrameMessage>): void => {
    if (event.source !== this.frame.contentWindow || event.origin !== chrome.runtime.getURL("").slice(0, -1)) return;
    const message = event.data;
    if (message?.source !== "tubitle-panel") return;
    if (message.type === "PANEL_READY") {
      this.frameReady = true;
      if (this.snapshot) this.post({ source: "tubitle-host", type: "TRANSCRIPT_STATE", state: this.snapshot });
      this.post({ source: "tubitle-host", type: "PANEL_PLAYBACK", playing: this.playbackActive });
      if (this.pendingTab) this.post({ source: "tubitle-host", type: "OPEN_PANEL_TAB", tab: this.pendingTab });
      if (this.pendingWord) {
        this.post({ source: "tubitle-host", type: "LOOKUP_WORD", word: this.pendingWord });
        this.pendingWord = undefined;
      }
    } else if (message.type === "SEEK_TO_CAPTION" && Number.isInteger(message.index)) {
      this.handlers.onSeek(message.index);
    } else if (message.type === "STUDY_CAPTION") {
      this.handlers.onStudy(message.videoId, message.sentenceId);
    } else if (message.type === "PREFETCH_CAPTIONS" && Array.isArray(message.indexes)) {
      this.handlers.onPrefetch(message.indexes.filter(Number.isInteger));
    } else if (message.type === "COLLAPSE_PANEL") {
      this.manuallyCollapsed = true;
      this.forcedOverlay = false;
      this.applyLayout();
    }
  };

  private post(message: TranscriptPanelHostMessage): void {
    if (!this.frameReady) return;
    this.frame.contentWindow?.postMessage(message, chrome.runtime.getURL("").slice(0, -1));
  }

  private panelTop(top: number, height: number): number {
    return this.keepInView
      ? Math.max(EDGE_GAP, Math.min(top, window.innerHeight - height - EDGE_GAP))
      : top;
  }

  private applyLayout(): void {
    if (!this.visible || !this.lastBounds) return;
    const bounds = this.lastBounds;
    const availableRight = window.innerWidth - bounds.right - EDGE_GAP * 2;
    const canDock = availableRight >= PANEL_MIN_WIDTH;
    const launcherOnly = this.manuallyCollapsed || (!canDock && !this.forcedOverlay);
    this.host.classList.toggle("launcher-only", launcherOnly);

    if (launcherOnly) {
      this.setPlaybackActive(false);
      this.host.style.top = `${this.panelTop(bounds.top + 18, 42)}px`;
      if (canDock) {
        this.host.style.left = `${bounds.right + EDGE_GAP}px`;
        this.host.style.right = "auto";
      } else {
        this.host.style.left = "auto";
        this.host.style.right = "16px";
      }
      this.host.style.width = "auto";
      this.host.style.height = "auto";
      return;
    }

    const width = canDock
      ? availableRight
      : Math.min(PANEL_OVERLAY_MAX_WIDTH, Math.max(260, window.innerWidth - 32));
    const height = this.keepInView
      ? Math.min(Math.max(REVIEW_MIN_HEIGHT, bounds.height), Math.max(1, window.innerHeight - 2 * EDGE_GAP))
      : Math.max(1, bounds.height);
    this.host.style.top = `${this.panelTop(bounds.top, height)}px`;
    this.host.style.height = `${height}px`;
    this.host.style.width = `${width}px`;
    if (canDock) {
      this.host.style.left = `${bounds.right + EDGE_GAP}px`;
      this.host.style.right = "auto";
    } else {
      this.host.style.left = "auto";
      this.host.style.right = "16px";
    }
  }
}
