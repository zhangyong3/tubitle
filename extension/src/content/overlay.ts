import type {
  CaptionSentence,
  SubtitleAppearance,
  SubtitlePosition
} from "../shared/types";
import {
  clampNumber,
  normalizeSubtitlePosition,
  positionToViewport,
  viewportToPosition
} from "./positioning";

interface OverlayHandlers {
  onEnter: () => void;
  onLeave: () => void;
  onLookup: (word: string) => void;
  onCopy: (word: string) => Promise<void>;
  onPositionChange: (position: SubtitlePosition) => void;
  onAnalyze: () => void;
}

const STYLES = `
  :host{all:initial;position:fixed;z-index:2147483646;left:50%;top:74%;transform:translate(-50%,-50%);width:min(900px,88vw);pointer-events:none;font-family:Inter,system-ui,-apple-system,"PingFang SC",sans-serif}
  *{box-sizing:border-box}.panel{position:relative;display:none;pointer-events:auto;text-align:center;color:#fff;filter:drop-shadow(0 3px 14px rgba(0,0,0,.72))}.panel.visible{display:block}
  .caption{display:none;position:relative;flex-direction:column;align-items:center;gap:5px;max-width:100%;padding:10px 16px 11px;border-radius:12px;background:rgba(10,11,15,.46);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);cursor:grab;touch-action:none}.caption.visible{display:inline-flex}.caption.dragging{cursor:grabbing}
  .english,.chinese{max-width:100%;line-height:1.42;text-wrap:balance;cursor:default}.english{font-size:var(--tt-english-size,19px);font-weight:680;letter-spacing:.01em;color:var(--tt-english-color,#fff)}.chinese{font-size:var(--tt-chinese-size,20px);font-weight:520;color:var(--tt-chinese-color,#ffe58f)}.chinese.hidden{display:none}
  .word{position:relative;border-radius:4px;cursor:pointer;transition:background .12s,color .12s;user-select:none}.word:hover{background:#7c5cff;color:#fff}.word.copied::after,.word.copy-error::after{content:"已复制";position:absolute;z-index:4;left:50%;top:-8px;transform:translate(-50%,-100%);border:1px solid rgba(255,255,255,.22);border-radius:7px;padding:4px 7px;background:#7c5cff;color:#fff;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35)}.word.copy-error::after{content:"复制失败";background:#b83a4b}
  .analyze-action{position:absolute;right:7px;bottom:7px;display:grid;width:32px;height:32px;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:9px;padding:0;background:rgba(20,18,31,.92);color:#d8ceff;opacity:0;visibility:hidden;pointer-events:none;transform:translate(3px,3px) scale(.88);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.38);transition:opacity .15s,transform .15s,visibility .15s,background .15s,color .15s}.caption:hover .analyze-action,.analyze-action:focus-visible{opacity:1;visibility:visible;pointer-events:auto;transform:none}.analyze-action:hover,.analyze-action:focus-visible{outline:none;background:#7c5cff;color:#fff}.analyze-action svg{width:19px;height:19px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.analyze-action .spark{fill:currentColor;stroke:none}
  .status{display:none;margin:0 auto 8px;width:max-content;max-width:80vw;padding:7px 11px;border-radius:8px;background:rgba(12,13,18,.85);color:#d9dae2;font-size:12px}.status.visible{display:block}.status.error{color:#ffb4b4}
`;

function tokenize(text: string): Array<{ value: string; word: boolean }> {
  const tokens = text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu) ?? [];
  return tokens.map((value) => ({ value, word: /^[\p{L}\p{M}]/u.test(value) }));
}

export class SubtitleOverlay {
  private readonly host = document.createElement("div");
  private readonly panel: HTMLDivElement;
  private readonly english: HTMLDivElement;
  private readonly chinese: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private sentence?: CaptionSentence;
  private chineseVisible = true;
  private position: SubtitlePosition = { xPercent: 50, yPercent: 74 };
  private videoBounds?: DOMRect;
  private wordClickTimer?: number;
  private wordFeedbackTimer?: number;
  private drag?: { pointerId: number; offsetX: number; offsetY: number };

  constructor(private readonly handlers: OverlayHandlers) {
    this.host.id = "tubetitle-root";
    const root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    root.append(style);

    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.panel.innerHTML = `
      <div class="status"></div>
      <div class="caption">
        <button class="analyze-action" type="button" data-action="analyze" title="AI 解析本句" aria-label="AI 解析本句">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.8 5.2 4 4L8.4 19.6a2 2 0 0 1-2.8-2.8Z" />
            <path d="m12.8 7.2 4 4" />
            <path d="M6 2.5v3M4.5 4h3M19 15.5v4M17 17.5h4" />
            <circle class="spark" cx="19" cy="4.5" r="1" />
          </svg>
        </button>
        <div class="english"></div><div class="chinese"></div>
      </div>`;
    root.append(this.panel);
    this.english = this.panel.querySelector(".english")!;
    this.chinese = this.panel.querySelector(".chinese")!;
    this.status = this.panel.querySelector(".status")!;
    this.caption = this.panel.querySelector(".caption")!;

    this.panel.addEventListener("pointerenter", this.handlers.onEnter);
    this.panel.addEventListener("pointerleave", () => {
      this.handlers.onLeave();
    });
    this.caption.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.caption.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.caption.addEventListener("pointerup", (event) => this.endDrag(event));
    this.caption.addEventListener("pointercancel", (event) => this.endDrag(event));
    this.panel.querySelector('[data-action="analyze"]')?.addEventListener("click", () => {
      this.handlers.onAnalyze();
    });
    document.documentElement.append(this.host);
  }

  setEnabled(enabled: boolean): void {
    this.host.style.display = enabled ? "block" : "none";
  }

  setChineseVisible(visible: boolean): void {
    this.chineseVisible = visible;
    this.chinese.classList.toggle("hidden", !visible);
  }

  setAppearance(appearance: SubtitleAppearance): void {
    this.host.style.setProperty("--tt-english-size", `${clampNumber(appearance.englishFontSize, 14, 48, 19)}px`);
    this.host.style.setProperty("--tt-chinese-size", `${clampNumber(appearance.chineseFontSize, 12, 42, 20)}px`);
    this.host.style.setProperty("--tt-english-color", validColor(appearance.englishColor, "#ffffff"));
    this.host.style.setProperty("--tt-chinese-color", validColor(appearance.chineseColor, "#ffe58f"));
  }

  setPosition(position: SubtitlePosition): void {
    this.position = normalizeSubtitlePosition(position);
    this.applyVideoPosition();
  }

  updateVideoBounds(bounds: DOMRect): void {
    this.videoBounds = bounds;
    this.host.style.width = `${Math.max(260, Math.min(900, bounds.width * 0.92))}px`;
    this.applyVideoPosition();
  }

  attachTo(parent: Element): void {
    if (this.host.parentElement !== parent) parent.append(this.host);
  }

  showSentence(sentence: CaptionSentence): void {
    if (this.sentence?.id === sentence.id) return;
    this.sentence = sentence;
    this.panel.classList.add("visible");
    this.caption.classList.add("visible");
    window.clearTimeout(this.wordClickTimer);
    window.clearTimeout(this.wordFeedbackTimer);
    this.english.replaceChildren();
    for (const token of tokenize(sentence.text)) {
      if (!token.word) {
        this.english.append(document.createTextNode(token.value));
        continue;
      }
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = token.value;
      span.title = "单击复制，双击查询";
      span.addEventListener("click", (event) => this.handleWordClick(event, span, token.value));
      span.addEventListener("dblclick", (event) => this.handleWordDoubleClick(event, token.value));
      this.english.append(span);
    }
    this.chinese.textContent = "";
    this.chinese.classList.toggle("hidden", !this.chineseVisible);
  }

  hideSentence(): void {
    this.sentence = undefined;
    this.caption.classList.remove("visible");
    if (!this.status.classList.contains("visible")) this.panel.classList.remove("visible");
  }

  showTranslation(sentenceId: string, translation: string): void {
    if (this.sentence?.id !== sentenceId) return;
    this.chinese.textContent = translation;
  }

  showTranslationError(sentenceId: string, message = "翻译暂时不可用"): void {
    if (this.sentence?.id !== sentenceId) return;
    this.chinese.textContent = message;
  }

  showStatus(message: string, error = false): void {
    this.panel.classList.add("visible");
    this.status.textContent = message;
    this.status.className = `status visible${error ? " error" : ""}`;
  }

  clearStatus(): void {
    this.status.className = "status";
    this.status.textContent = "";
    if (!this.sentence) this.panel.classList.remove("visible");
  }

  destroy(): void {
    this.host.remove();
  }

  private handleWordClick(event: MouseEvent, element: HTMLElement, word: string): void {
    event.stopPropagation();
    window.clearTimeout(this.wordClickTimer);
    this.wordClickTimer = window.setTimeout(() => { void this.copyWord(word, element); }, 220);
  }

  private handleWordDoubleClick(event: MouseEvent, word: string): void {
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(this.wordClickTimer);
    this.handlers.onLookup(word);
  }

  private async copyWord(word: string, element: HTMLElement): Promise<void> {
    window.clearTimeout(this.wordFeedbackTimer);
    element.classList.remove("copied", "copy-error");
    try {
      await this.handlers.onCopy(word);
      element.classList.add("copied");
    } catch {
      element.classList.add("copy-error");
    }
    this.wordFeedbackTimer = window.setTimeout(() => {
      element.classList.remove("copied", "copy-error");
    }, 1000);
  }

  private startDrag(event: PointerEvent): void {
    if (event.target !== this.caption || !this.videoBounds) return;
    const anchor = positionToViewport(this.videoBounds, this.position);
    this.drag = { pointerId: event.pointerId, offsetX: event.clientX - anchor.x, offsetY: event.clientY - anchor.y };
    this.caption.setPointerCapture(event.pointerId);
    this.caption.classList.add("dragging");
    event.preventDefault();
  }

  private moveDrag(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.videoBounds) return;
    this.position = viewportToPosition(
      this.videoBounds,
      event.clientX - this.drag.offsetX,
      event.clientY - this.drag.offsetY
    );
    this.applyVideoPosition();
  }

  private endDrag(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    this.drag = undefined;
    this.caption.classList.remove("dragging");
    if (this.caption.hasPointerCapture(event.pointerId)) this.caption.releasePointerCapture(event.pointerId);
    this.handlers.onPositionChange({ ...this.position });
  }

  private applyVideoPosition(): void {
    if (!this.videoBounds) return;
    const point = positionToViewport(this.videoBounds, this.position);
    this.host.style.left = `${point.x}px`;
    this.host.style.top = `${point.y}px`;
  }
}

function validColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
