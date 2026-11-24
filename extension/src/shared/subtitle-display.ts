import type { ExtensionSettings } from './types';
export type SubtitleDisplayMode = 'hidden' | 'bilingual' | 'source';
export function subtitleDisplayMode(settings: Pick<ExtensionSettings, 'hideSubtitles' | 'showChinese'>): SubtitleDisplayMode {
  return settings.hideSubtitles ? 'hidden' : settings.showChinese ? 'bilingual' : 'source';
}
export function subtitleDisplayPatch(mode: SubtitleDisplayMode): Pick<ExtensionSettings, 'hideSubtitles' | 'showChinese'> {
  return { hideSubtitles: mode === 'hidden', showChinese: mode === 'bilingual' };
}
export function nextSubtitleDisplayMode(mode: SubtitleDisplayMode): SubtitleDisplayMode {
  return mode === 'bilingual' ? 'source' : mode === 'source' ? 'hidden' : 'bilingual';
}
export function subtitleTranslationEnabled(settings: Pick<ExtensionSettings, 'hideSubtitles' | 'showChinese'>): boolean {
  return subtitleDisplayMode(settings) === 'bilingual';
}
