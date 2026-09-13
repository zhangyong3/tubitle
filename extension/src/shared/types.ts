export type TranslationProvider = "microsoft" | "google" | "tencent";

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
  enabled: boolean;
  showChinese: boolean;
  hoverPause: boolean;
  resumeAfterHover: boolean;
  provider: TranslationProvider;
  serverBaseUrl: string;
  serverAccessToken: string;
  historyLimit: number;
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

export interface SentenceAnalysis {
  original: string;
  translation: string;
  structure: string[];
  vocabulary: Array<{ word: string; level: "B2" | "C1" | "C2"; meaning: string; example: string }>;
  phrases: Array<{ phrase: string; meaning: string; example: string }>;
}

export type ExtensionMessage =
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "TRANSLATE"; text: string; provider: TranslationProvider }
  | { type: "OPEN_ANALYSIS"; sentence: string }
  | { type: "OPEN_DICTIONARY"; word: string; offline: boolean };

export type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
