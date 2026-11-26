export type TranslationProvider = "microsoft" | "google" | "tencent" | "hy-mt-local" | "edge-free" | "google-free" | "volcengine-free" | "tencent-free" | "chrome-local";

export interface ShortcutSettings {
  previous: string;
  next: string;
  repeat: string;
  toggleTranslation: string;
  analyze: string;
}

export interface SubtitlePosition {
  xPercent: number;
  yPercent: number;
}

export interface SubtitleAppearance {
  englishFontSize: number;
  chineseFontSize: number;
  englishColor: string;
  chineseColor: string;
}

export interface ExtensionSettings {
  settingsVersion: number;
  uiLanguage: import("./ui-language").UiLanguage;
  serviceMode: import("./service-mode").ServiceMode;
  onlineDictionaries: import("./online-dictionaries").OnlineDictionary[];
  analysisServiceMode: import("./service-mode").ServiceMode;
  enabled: boolean;
  showChinese: boolean;
  hideSubtitles: boolean;
  targetLanguage: string;
  excludedLanguages: string[];
  hoverPause: boolean;
  resumeAfterHover: boolean;
  autoReturnToSubtitlesSeconds: number;
  provider: TranslationProvider;
  tubitleBaseUrl: string;
  tubitleApiKey: string;
  microsoftTranslatorKey: string;
  microsoftTranslatorRegion: string;
  microsoftTranslatorEndpoint: string;
  googleTranslateApiKey: string;
  tencentSecretId: string;
  tencentSecretKey: string;
  tencentRegion: string;
  tencentConcurrency: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  historyRetentionDays: number;
  offlineDictionary: {
    configured: boolean;
    name: string;
    size: number;
    lastModified: number;
  };
  offlineDictionaryCss: {
    configured: boolean;
    name: string;
    size: number;
    lastModified: number;
  };
  offlineDictionaryResources: {
    configured: boolean;
    files: Array<{ name: string; size: number; lastModified: number }>;
  };
  offlineDictionaryDirectory: {
    name: string;
    lastImported: number;
  };
  subtitlePosition: SubtitlePosition;
  subtitleAppearance: SubtitleAppearance;
  shortcuts: ShortcutSettings;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
  isTranslatable?: boolean;
}

export interface CaptionSentence {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptPanelSentence extends CaptionSentence {
  translationSkipped?: boolean;
  translation?: string;
  translationError?: string;
}

export interface TranscriptPanelSnapshot {
  displayMode?: import("./subtitle-display").SubtitleDisplayMode;
  sourceLanguage?: string;
  videoId: string;
  videoTitle: string;
  sentences: TranscriptPanelSentence[];
  activeIndex: number;
  currentTimeMs: number;
  durationMs: number;
  loading: boolean;
  positionPending?: boolean;
  error?: string;
}

export type TranscriptPanelTab = "subtitles" | "dictionary" | "analysis" | "history";

export type TranscriptPanelHostMessage =
  | { source: "tubitle-host"; type: "TRANSCRIPT_STATE"; state: TranscriptPanelSnapshot }
  | { source: "tubitle-host"; type: "TRANSCRIPT_ACTIVE"; activeIndex: number; currentTimeMs: number; durationMs: number }
  | { source: "tubitle-host"; type: "PANEL_PLAYBACK"; playing: boolean }
  | { source: "tubitle-host"; type: "TRANSCRIPT_TRANSLATION"; sentenceId: string; translation?: string; error?: string }
  | { source: "tubitle-host"; type: "STUDY_TRANSLATION"; videoId: string; sentence: CaptionSentence; translation?: string; error?: string }
  | { source: "tubitle-host"; type: "OPEN_PANEL_TAB"; tab: TranscriptPanelTab }
  | { source: "tubitle-host"; type: "LOOKUP_WORD"; word: string };

export type TranscriptPanelFrameMessage =
  | { source: "tubitle-panel"; type: "PANEL_READY" }
  | { source: "tubitle-panel"; type: "SET_SUBTITLE_MODE"; mode: import("./subtitle-display").SubtitleDisplayMode }
  | { source: "tubitle-panel"; type: "SEEK_HISTORY"; videoId: string; startMs: number }
  | { source: "tubitle-panel"; type: "SEEK_TO_CAPTION"; index: number }
  | { source: "tubitle-panel"; type: "STUDY_CAPTION"; videoId: string; sentenceId: string }
  | { source: "tubitle-panel"; type: "PREFETCH_CAPTIONS"; indexes: number[] }
  | { source: "tubitle-panel"; type: "COLLAPSE_PANEL" };

export interface SentenceAnalysis {
  original: string;
  translation: string;
  structure: string[];
  vocabulary: Array<{ word: string; level: "B2" | "C1" | "C2"; meaning: string; example: string }>;
  phrases: Array<{ phrase: string; meaning: string; example: string }>;
}

export type ExtensionMessage =
  | { type: "LEARNING_ACTIVITY"; activity: import("./learning-activity").LearningActivity }
  | { type: "LEARNING_SYNC_STATUS" }
  | { type: "CHECK_TRANSCRIPT_PDF_ACCESS" }
  | { type: "LEARNING_SYNC_ENQUEUE"; record: import("./learning-sync").SyncRecord }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "TRANSLATE"; text: string; sourceLanguage?: string; provider: TranslationProvider; priority?: "current" | "prefetch"; purpose?: "dictionary" }
  | { type: "TEST_PROVIDER"; provider: TranslationProvider | "llm" }
  | { type: "OPEN_ANALYSIS"; sentence: string };

export type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; retryAfterMs?: number };
