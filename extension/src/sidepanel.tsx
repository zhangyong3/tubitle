import { memo, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Mdict from "@tubetitle/mdict-browser";
import {
  DICTIONARY_QUERY_KEY,
  getOfflineDictionaryCss,
  getOfflineDictionaryFile,
  getOfflineDictionaryResourceFiles,
  type DictionaryQuery
} from "./shared/offline-dictionary";
import type {
  ExtensionSettings,
  TranscriptPanelFrameMessage,
  TranscriptPanelHostMessage,
  TranscriptPanelSnapshot,
  TranscriptPanelTab
} from "./shared/types";
import { normalizeDictionaryWord, selectDictionaryCandidates } from "./shared/dictionary-lookup";
import { sanitizeDictionaryHtml } from "./shared/dictionary-sanitize";
import { loadDictionaryCss } from "./shared/dictionary-presentation";
import { prepareDictionaryAudio } from "./shared/dictionary-audio";
import {
  ANALYSIS_QUERY_KEY,
  streamSentenceAnalysis,
  type AnalysisQuery
} from "./shared/analysis-stream";
import { getSettings } from "./shared/settings";
import {
  clearSidebarHistory,
  DEFAULT_HISTORY_LIMIT,
  parseSidebarHistory,
  recordAnalysisHistory,
  recordDictionaryHistory,
  SIDEBAR_HISTORY_KEY,
  trimSidebarHistory,
  type AnalysisHistoryEntry,
  type SidebarHistoryEntry
} from "./shared/sidebar-history";

type SidebarTab = TranscriptPanelTab;

const EMBEDDED = new URLSearchParams(location.search).has("embedded");
const YOUTUBE_ORIGIN = "https://www.youtube.com";

interface LookupResult {
  word: string;
  definition?: string;
  css?: string;
  audioUrls?: string[];
  missingAudio?: number;
  suggestions: string[];
  error?: string;
}

let dictionaryPromise: Promise<Mdict> | undefined;
let dictionaryCssPromise: Promise<string> | undefined;
let resourceDictionariesPromise: Promise<Mdict[]> | undefined;
let activeAudio: HTMLAudioElement | undefined;

function postToHost(message: TranscriptPanelFrameMessage): void {
  if (!EMBEDDED || window.parent === window) return;
  window.parent.postMessage(message, YOUTUBE_ORIGIN);
}

function getCustomDictionaryCss(): Promise<string> {
  dictionaryCssPromise ??= getOfflineDictionaryCss().catch((error) => {
    dictionaryCssPromise = undefined;
    throw error;
  });
  return dictionaryCssPromise;
}

function getResourceDictionaries(): Promise<Mdict[]> {
  resourceDictionariesPromise ??= getOfflineDictionaryResourceFiles().then(async (files) => {
    const dictionaries: Mdict[] = [];
    for (const file of files) dictionaries.push(await Mdict.build(file));
    return dictionaries;
  }).catch((error) => {
    resourceDictionariesPromise = undefined;
    throw error;
  });
  return resourceDictionariesPromise;
}

async function getDictionary(): Promise<Mdict> {
  if (!dictionaryPromise) {
    dictionaryPromise = getOfflineDictionaryFile().then(async (file) => {
      if (!file) throw new Error("离线词典文件不存在，请在扩展设置中重新选择 MDX 文件");
      return Mdict.build(file);
    }).catch((error) => {
      dictionaryPromise = undefined;
      throw error;
    });
  }
  return dictionaryPromise;
}

async function lookupWord(word: string): Promise<LookupResult> {
  const normalized = normalizeDictionaryWord(word);
  if (!normalized) return { word, suggestions: [], error: "无法识别查询单词" };
  try {
    const dictionary = await getDictionary();
    const candidates = await dictionary.getWordList(normalized);
    const { exact, suggestions } = selectDictionaryCandidates(normalized, candidates);
    if (!exact) return { word: normalized, suggestions };
    const definition = await dictionary.getDefinition(exact.offset);
    const css = await loadDictionaryCss(dictionary, definition, await getCustomDictionaryCss());
    const audio = await prepareDictionaryAudio(sanitizeDictionaryHtml(definition), await getResourceDictionaries());
    return {
      word: exact.word,
      definition: audio.html,
      css,
      suggestions,
      audioUrls: audio.urls,
      missingAudio: audio.missing
    };
  } catch (error) {
    return {
      word: normalized,
      suggestions: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const ENTRY_BASE_CSS = `
  html, body { box-sizing: border-box; min-width: 0; margin: 0; padding: 0; background: #fff; color: #24262d;
    font: 15px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
  *, *::before, *::after { box-sizing: inherit; }
  body { padding: 16px; }
  h1, h2, h3 { margin: .65em 0 .35em; line-height: 1.3; }
  p { margin: .55em 0; }
  ul, ol { padding-left: 1.5em; }
  table { max-width: 100%; border-collapse: collapse; }
  td, th { padding: 5px; border: 1px solid #d7d9df; }
  a { color: #5b45c8; cursor: pointer; text-decoration: none; }
  img, audio, video { display: none !important; }
`;

const ENTRY_LAYOUT_CSS = `
  html, body { width: 100% !important; min-height: 0 !important; height: auto !important; overflow: visible !important; }
`;

function DictionaryDefinition({ html, css, onSearch, onPlaybackError }: {
  html: string;
  css?: string;
  onSearch: (word: string) => void;
  onPlaybackError: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const onSearchRef = useRef(onSearch);
  const onPlaybackErrorRef = useRef(onPlaybackError);
  onSearchRef.current = onSearch;
  onPlaybackErrorRef.current = onPlaybackError;

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let observer: ResizeObserver | undefined;
    const render = () => {
      const documentValue = iframe.contentDocument;
      if (!documentValue) return;
      const style = documentValue.createElement("style");
      style.textContent = `${ENTRY_BASE_CSS}\n${css ?? ""}\n${ENTRY_LAYOUT_CSS}`;
      documentValue.head.replaceChildren(style);
      documentValue.body.innerHTML = html;
      const resize = () => {
        iframe.style.height = `${Math.max(120, documentValue.documentElement.scrollHeight)}px`;
      };
      const click = (event: Event) => {
        const sound = (event.target as Element | null)?.closest<HTMLElement>("[data-sound]");
        if (sound) {
          event.preventDefault();
          const audioUrl = sound.dataset.audioUrl;
          if (!audioUrl) {
            onPlaybackErrorRef.current("未找到该发音资源，请在扩展设置中选择与 MDX 配套的 MDD 文件。");
            return;
          }
          activeAudio?.pause();
          activeAudio = new Audio(audioUrl);
          void activeAudio.play().catch(() => onPlaybackErrorRef.current("音频播放失败，该格式可能不受浏览器支持。"));
          return;
        }
        const link = (event.target as Element | null)?.closest<HTMLElement>("[data-entry]");
        const entry = link?.dataset.entry;
        if (entry) { event.preventDefault(); onSearchRef.current(entry); }
      };
      documentValue.addEventListener("click", click);
      observer = new ResizeObserver(resize);
      observer.observe(documentValue.body);
      resize();
    };
    iframe.addEventListener("load", render, { once: true });
    iframe.srcdoc = "<!doctype html><html><head></head><body></body></html>";
    return () => {
      iframe.removeEventListener("load", render);
      observer?.disconnect();
    };
  }, [html, css]);
  return <iframe className="definition" ref={frame} title="离线词典释义" sandbox="allow-same-origin" />;
}

function App() {
  const [activeTab, setActiveTab] = useState<SidebarTab>(EMBEDDED ? "subtitles" : "dictionary");
  const [transcript, setTranscript] = useState<TranscriptPanelSnapshot>();
  const [transcriptAutoFollow, setTranscriptAutoFollow] = useState(true);
  const [result, setResult] = useState<LookupResult>();
  const [loadingWord, setLoadingWord] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [analysisSentence, setAnalysisSentence] = useState("");
  const [analysisText, setAnalysisText] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState<"streaming" | "done" | "error">("streaming");
  const [analysisError, setAnalysisError] = useState("");
  const [copyStatus, setCopyStatus] = useState("复制到笔记");
  const [history, setHistory] = useState<SidebarHistoryEntry[]>([]);
  const [historyLimit, setHistoryLimit] = useState(DEFAULT_HISTORY_LIMIT);
  const analysisController = useRef<AbortController | undefined>(undefined);
  const typewriterQueue = useRef("");
  const typewriterTimer = useRef<number | undefined>(undefined);
  const upstreamFinished = useRef(false);
  const upstreamError = useRef("");
  const upstreamText = useRef("");
  const historyLimitRef = useRef(DEFAULT_HISTORY_LIMIT);

  useEffect(() => {
    if (!EMBEDDED) return;
    const listener = (event: MessageEvent<TranscriptPanelHostMessage>) => {
      if (event.source !== window.parent || event.origin !== YOUTUBE_ORIGIN) return;
      const message = event.data;
      if (message?.source !== "tubitle-host") return;
      if (message.type === "TRANSCRIPT_STATE") {
        setTranscript(message.state);
      } else if (message.type === "TRANSCRIPT_ACTIVE") {
        setTranscript((current) => current ? {
          ...current,
          activeIndex: message.activeIndex,
          currentTimeMs: message.currentTimeMs,
          durationMs: message.durationMs
        } : current);
      } else if (message.type === "TRANSCRIPT_TRANSLATION") {
        setTranscript((current) => current ? {
          ...current,
          sentences: current.sentences.map((sentence) => sentence.id === message.sentenceId
            ? { ...sentence, translation: message.translation, translationError: message.error }
            : sentence)
        } : current);
      } else if (message.type === "OPEN_PANEL_TAB") {
        setActiveTab(message.tab);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  function stopAnalysisStream() {
    analysisController.current?.abort();
    analysisController.current = undefined;
    if (typewriterTimer.current !== undefined) window.clearInterval(typewriterTimer.current);
    typewriterTimer.current = undefined;
  }

  function analyze(query: AnalysisQuery) {
    stopAnalysisStream();
    setActiveTab("analysis");
    setAnalysisSentence(query.sentence);
    setAnalysisText("");
    setAnalysisError("");
    setAnalysisStatus("streaming");
    setCopyStatus("复制到笔记");
    typewriterQueue.current = "";
    upstreamFinished.current = false;
    upstreamError.current = "";
    upstreamText.current = "";
    const controller = new AbortController();
    analysisController.current = controller;
    typewriterTimer.current = window.setInterval(() => {
      if (typewriterQueue.current) {
        const count = typewriterQueue.current.length > 80 ? 3 : 1;
        const next = typewriterQueue.current.slice(0, count);
        typewriterQueue.current = typewriterQueue.current.slice(count);
        setAnalysisText((current) => current + next);
      } else if (upstreamFinished.current) {
        if (typewriterTimer.current !== undefined) window.clearInterval(typewriterTimer.current);
        typewriterTimer.current = undefined;
        if (upstreamError.current) {
          setAnalysisError(upstreamError.current);
          setAnalysisStatus("error");
        } else {
          setAnalysisStatus("done");
        }
      }
    }, 18);
    void streamSentenceAnalysis(
      query.sentence,
      (delta) => {
        typewriterQueue.current += delta;
        upstreamText.current += delta;
      },
      controller.signal
    ).then(() => {
      if (analysisController.current !== controller) return;
      upstreamFinished.current = true;
      void recordAnalysisHistory(query, upstreamText.current, historyLimitRef.current).then(setHistory);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || analysisController.current !== controller) return;
      upstreamError.current = error instanceof Error ? error.message : String(error);
      upstreamFinished.current = true;
    });
  }

  async function search(word: string, saveToHistory = true) {
    setActiveTab("dictionary");
    setLoadingWord(word);
    setPlaybackError("");
    setResult(undefined);
    if (saveToHistory) void recordDictionaryHistory(word, historyLimitRef.current).then(setHistory);
    const next = await lookupWord(word);
    setResult(next);
    setLoadingWord("");
  }

  useEffect(() => () => {
    for (const url of result?.audioUrls ?? []) URL.revokeObjectURL(url);
  }, [result]);

  useEffect(() => () => stopAnalysisStream(), []);

  useEffect(() => {
    let latestWord = "";
    void Promise.all([
      chrome.storage.local.get([DICTIONARY_QUERY_KEY, ANALYSIS_QUERY_KEY, SIDEBAR_HISTORY_KEY]),
      getSettings()
    ]).then(([stored, settings]) => {
      historyLimitRef.current = settings.historyLimit;
      setHistoryLimit(settings.historyLimit);
      const savedHistory = parseSidebarHistory(stored[SIDEBAR_HISTORY_KEY]);
      setHistory(savedHistory);
      if (EMBEDDED) return;
      const dictionaryQuery = stored[DICTIONARY_QUERY_KEY] as DictionaryQuery | undefined;
      const analysisQuery = stored[ANALYSIS_QUERY_KEY] as AnalysisQuery | undefined;
      if (analysisQuery?.sentence && (analysisQuery.createdAt ?? 0) >= (dictionaryQuery?.createdAt ?? 0)) {
        const saved = savedHistory.find((entry): entry is AnalysisHistoryEntry =>
          entry.type === "analysis" && entry.requestId === analysisQuery.requestId
        );
        if (saved) openSavedAnalysis(saved);
        else analyze(analysisQuery);
      } else if (dictionaryQuery?.word) {
        latestWord = dictionaryQuery.word;
        void search(dictionaryQuery.word);
      }
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      const query = changes[DICTIONARY_QUERY_KEY]?.newValue as DictionaryQuery | undefined;
      if (query?.word) { latestWord = query.word; void search(query.word); }
      const analysisQuery = changes[ANALYSIS_QUERY_KEY]?.newValue as AnalysisQuery | undefined;
      if (analysisQuery?.sentence) analyze(analysisQuery);
      if (changes[SIDEBAR_HISTORY_KEY]) setHistory(parseSidebarHistory(changes[SIDEBAR_HISTORY_KEY].newValue));
      if (changes.settings) {
        const previous = changes.settings.oldValue as ExtensionSettings | undefined;
        const next = changes.settings.newValue as ExtensionSettings | undefined;
        const nextHistoryLimit = next?.historyLimit ?? DEFAULT_HISTORY_LIMIT;
        historyLimitRef.current = nextHistoryLimit;
        setHistoryLimit(nextHistoryLimit);
        if (
          previous?.offlineDictionary.name !== next?.offlineDictionary.name ||
          previous?.offlineDictionary.lastModified !== next?.offlineDictionary.lastModified ||
          previous?.offlineDictionary.size !== next?.offlineDictionary.size
        ) dictionaryPromise = undefined;
        if (
          previous?.offlineDictionaryCss?.name !== next?.offlineDictionaryCss?.name ||
          previous?.offlineDictionaryCss?.lastModified !== next?.offlineDictionaryCss?.lastModified ||
          previous?.offlineDictionaryCss?.size !== next?.offlineDictionaryCss?.size
        ) {
          dictionaryCssPromise = undefined;
          if (latestWord) void search(latestWord);
        }
        if (
          JSON.stringify(previous?.offlineDictionaryResources?.files ?? []) !==
          JSON.stringify(next?.offlineDictionaryResources?.files ?? [])
        ) {
          resourceDictionariesPromise = undefined;
          if (latestWord) void search(latestWord);
        }
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function copyAnalysis() {
    const content = `原句：${analysisSentence}\n${analysisText}`.trim();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus("已复制 ✓");
    } catch {
      setCopyStatus("复制失败");
    }
    window.setTimeout(() => setCopyStatus("复制到笔记"), 1200);
  }

  function openSavedAnalysis(entry: AnalysisHistoryEntry) {
    stopAnalysisStream();
    typewriterQueue.current = "";
    upstreamFinished.current = true;
    upstreamError.current = "";
    upstreamText.current = entry.result;
    setActiveTab("analysis");
    setAnalysisSentence(entry.sentence);
    setAnalysisText(entry.result);
    setAnalysisError("");
    setAnalysisStatus("done");
    setCopyStatus("复制到笔记");
  }

  async function clearHistory() {
    await clearSidebarHistory();
    setHistory([]);
  }

  const tabs = <SidebarTabs activeTab={activeTab} onSelect={setActiveTab} />;

  if (activeTab === "subtitles") {
    return (
      <div className="sidepanel-shell embedded-shell">
        {tabs}
        <TranscriptPage
          snapshot={transcript}
          autoFollow={transcriptAutoFollow}
          onAutoFollowChange={setTranscriptAutoFollow}
        />
      </div>
    );
  }

  if (activeTab === "analysis") {
    return (
      <div className="sidepanel-shell">
        {tabs}
        <main className="analysis-page" id="analysis-panel" role="tabpanel" aria-labelledby="analysis-tab">
        <header className="analysis-header">
          <div><div className="brand">Tubitle</div><h1>句子解析</h1></div>
          <button type="button" onClick={() => void copyAnalysis()}>{copyStatus}</button>
        </header>
        <section className="analysis-original"><div className="analysis-label">原句</div><p>{analysisSentence}</p></section>
        <section className="analysis-output">
          {analysisText ? <AnalysisText value={analysisText} /> : <div className="analysis-waiting">正在连接大模型…</div>}
          {analysisStatus === "streaming" && <span className="typewriter-cursor" aria-hidden="true" />}
        </section>
        {analysisError && <div className="analysis-stream-error">{analysisError}</div>}
        <div className={`analysis-progress ${analysisStatus}`}>
          {analysisStatus === "streaming" ? "大模型正在生成，内容会实时显示…" : analysisStatus === "done" ? "解析完成" : "解析未完整完成"}
        </div>
        </main>
      </div>
    );
  }

  if (activeTab === "history") {
    const visibleHistory = trimSidebarHistory(history, historyLimit);
    return (
      <div className="sidepanel-shell">
        {tabs}
        <main className="history-page" id="history-panel" role="tabpanel" aria-labelledby="history-tab">
          <header className="history-header">
            <div><div className="brand">Tubitle</div><h1>历史记录</h1></div>
            {visibleHistory.length > 0 && <button type="button" onClick={() => void clearHistory()}>清空</button>}
          </header>
          {visibleHistory.length > 0 ? (
            <div className="history-list">
              {visibleHistory.map((entry) => (
                <button
                  type="button"
                  className="history-item"
                  key={entry.id}
                  onClick={() => entry.type === "dictionary" ? void search(entry.word, false) : openSavedAnalysis(entry)}
                >
                  <span className={`history-kind ${entry.type}`}>{entry.type === "dictionary" ? "查词" : "语句分析"}</span>
                  <span className="history-content">
                    <strong>{entry.type === "dictionary" ? entry.word : entry.sentence}</strong>
                    {entry.type === "analysis" && <small>{analysisPreview(entry.result)}</small>}
                  </span>
                  <time dateTime={new Date(entry.createdAt).toISOString()}>{formatHistoryTime(entry.createdAt)}</time>
                </button>
              ))}
            </div>
          ) : <div className="status empty">暂无历史记录。查词或完成语句分析后会自动保存在这里。</div>}
        </main>
      </div>
    );
  }

  return (
    <div className="sidepanel-shell">
      {tabs}
      <main
        className={`page${result?.definition ? " definition-page" : ""}`}
        id="dictionary-panel"
        role="tabpanel"
        aria-labelledby="dictionary-tab"
      >
        {!result?.definition && <div className="brand">Tubitle · 离线词典</div>}
        {loadingWord ? (
          <><h1 className="word">{loadingWord}</h1><div className="status">正在加载 MDX 词典并查询…</div></>
        ) : result ? (
          <>
            {!result.definition && <h1 className="word">{result.word}</h1>}
            {playbackError && <div className="audio-error">{playbackError}</div>}
            {result.error ? <div className="status error">{result.error}</div> : result.definition ? (
              <DictionaryDefinition
                html={result.definition}
                css={result.css}
                onSearch={(entry) => void search(entry)}
                onPlaybackError={setPlaybackError}
              />
            ) : <div className="status empty">词典中没有找到完全匹配的词条。</div>}
            {result.suggestions.length > 0 && (
              <div className="suggestions"><div className="brand">相关词条</div>{result.suggestions.map((word) => (
                <button type="button" key={word} onClick={() => void search(word)}>{word}</button>
              ))}</div>
            )}
          </>
        ) : <div className="status">在 YouTube 字幕中双击英文单词，即可在这里查询。</div>}
      </main>
    </div>
  );
}

function SidebarTabs({ activeTab, onSelect }: {
  activeTab: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
}) {
  return (
    <nav className="side-tabs" role="tablist" aria-label="学习工具">
      <button
        type="button"
        className={`side-tab${activeTab === "subtitles" ? " active" : ""}`}
        id="subtitles-tab"
        role="tab"
        aria-selected={activeTab === "subtitles"}
        aria-controls="subtitles-panel"
        onClick={() => onSelect("subtitles")}
      >
        字幕
      </button>
      <button
        type="button"
        className={`side-tab${activeTab === "dictionary" ? " active" : ""}`}
        id="dictionary-tab"
        role="tab"
        aria-selected={activeTab === "dictionary"}
        aria-controls="dictionary-panel"
        onClick={() => onSelect("dictionary")}
      >
        查词
      </button>
      <button
        type="button"
        className={`side-tab${activeTab === "analysis" ? " active" : ""}`}
        id="analysis-tab"
        role="tab"
        aria-selected={activeTab === "analysis"}
        aria-controls="analysis-panel"
        onClick={() => onSelect("analysis")}
      >
        语句分析
      </button>
      <button
        type="button"
        className={`side-tab${activeTab === "history" ? " active" : ""}`}
        id="history-tab"
        role="tab"
        aria-selected={activeTab === "history"}
        aria-controls="history-panel"
        onClick={() => onSelect("history")}
      >
        历史
      </button>
    </nav>
  );
}

function TranscriptPage({ snapshot, autoFollow, onAutoFollowChange }: {
  snapshot?: TranscriptPanelSnapshot;
  autoFollow: boolean;
  onAutoFollowChange: (value: boolean) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const scrollFrame = useRef<number | undefined>(undefined);
  const activeIndex = snapshot?.activeIndex ?? -1;

  function requestVisibleTranslations() {
    const list = listRef.current;
    if (!list || !snapshot?.sentences.length) return;
    const bounds = list.getBoundingClientRect();
    const indexes = Array.from(list.querySelectorAll<HTMLElement>(".transcript-item"))
      .filter((item) => {
        const itemBounds = item.getBoundingClientRect();
        return itemBounds.bottom >= bounds.top - 160 && itemBounds.top <= bounds.bottom + 160;
      })
      .map((item) => Number(item.dataset.index))
      .filter(Number.isInteger);
    if (indexes.length > 0) postToHost({ source: "tubitle-panel", type: "PREFETCH_CAPTIONS", indexes });
  }

  useEffect(() => {
    if (!snapshot) return;
    if (autoFollow && activeIndex >= 0) {
      listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    window.setTimeout(requestVisibleTranslations, 0);
  }, [snapshot?.videoId, snapshot?.sentences.length, activeIndex, autoFollow]);

  useEffect(() => () => {
    if (scrollFrame.current !== undefined) window.cancelAnimationFrame(scrollFrame.current);
  }, []);

  const progress = snapshot && snapshot.durationMs > 0
    ? Math.min(100, Math.max(0, snapshot.currentTimeMs / snapshot.durationMs * 100))
    : 0;

  return (
    <main className="transcript-page" id="subtitles-panel" role="tabpanel" aria-labelledby="subtitles-tab">
      <header className="transcript-header">
        <div className="transcript-heading-copy">
          <div className="brand">Tubitle · 当前视频</div>
          <h1>{snapshot?.videoTitle || "双语字幕"}</h1>
        </div>
        <div className="transcript-actions">
          <label><input type="checkbox" checked={autoFollow} onChange={(event) => onAutoFollowChange(event.target.checked)} /> 自动跟随</label>
          {EMBEDDED && (
            <button
              type="button"
              className="collapse-panel"
              aria-label="收起学习面板"
              onClick={() => postToHost({ source: "tubitle-panel", type: "COLLAPSE_PANEL" })}
            >
              收起
            </button>
          )}
        </div>
      </header>
      <div className="transcript-progress" aria-label="视频播放进度">
        <time>{formatCaptionTime(snapshot?.currentTimeMs ?? 0)}</time>
        <div><span style={{ width: `${progress}%` }} /></div>
        <time>{formatCaptionTime(snapshot?.durationMs ?? 0)}</time>
      </div>
      {snapshot?.loading ? (
        <div className="transcript-state">正在读取当前视频字幕…</div>
      ) : snapshot?.error ? (
        <div className="transcript-state error">{snapshot.error}</div>
      ) : snapshot?.sentences.length ? (
        <ol
          className="transcript-list"
          ref={listRef}
          onScroll={() => {
            if (scrollFrame.current !== undefined) window.cancelAnimationFrame(scrollFrame.current);
            scrollFrame.current = window.requestAnimationFrame(requestVisibleTranslations);
          }}
        >
          {snapshot.sentences.map((sentence, index) => (
            <TranscriptCueRow sentence={sentence} index={index} active={index === activeIndex} key={sentence.id} />
          ))}
        </ol>
      ) : (
        <div className="transcript-state">打开一个带英文字幕的 YouTube 视频后，字幕会显示在这里。</div>
      )}
    </main>
  );
}

const TranscriptCueRow = memo(function TranscriptCueRow({ sentence, index, active }: {
  sentence: TranscriptPanelSnapshot["sentences"][number];
  index: number;
  active: boolean;
}) {
  return (
    <li className={`transcript-item${active ? " active" : ""}`} data-index={index}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => postToHost({ source: "tubitle-panel", type: "SEEK_TO_CAPTION", index })}
      >
        <time>{formatCaptionTime(sentence.startMs)}</time>
        <span className="timeline-node" aria-hidden="true">{active ? "▶" : ""}</span>
        <span className="transcript-copy">
          <strong>{sentence.text}</strong>
          <small className={sentence.translationError ? "translation-error" : ""}>
            {sentence.translation || sentence.translationError || "正在翻译…"}
          </small>
        </span>
      </button>
    </li>
  );
});

function formatCaptionTime(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs < 0) return "00:00";
  const seconds = Math.floor(valueMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function analysisPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 100);
}

function formatHistoryTime(createdAt: number): string {
  const date = new Date(createdAt);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function AnalysisText({ value }: { value: string }) {
  return <div className="analysis-text">{value.split("\n").map((line, index) => {
    const heading = /^(翻译|结构|词汇|短语)\s*[：:](.*)$/.exec(line);
    return <div className={heading ? "analysis-line heading" : "analysis-line"} key={index}>
      {heading ? <><strong>{heading[1]}</strong><span>{heading[2]}</span></> : line || "\u00a0"}
    </div>;
  })}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
