import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { subtitleDisplayMode, subtitleDisplayPatch, subtitleTranslationEnabled, nextSubtitleDisplayMode } from './subtitle-display';
it('cycles all three display states and translates only in bilingual mode', () => {
  let mode = subtitleDisplayMode(DEFAULT_SETTINGS);
  expect(mode).toBe('bilingual');
  for (const expected of ['source', 'hidden', 'bilingual'] as const) {
    mode = nextSubtitleDisplayMode(mode);
    expect(mode).toBe(expected);
    const settings = { ...DEFAULT_SETTINGS, ...subtitleDisplayPatch(mode) };
    expect(subtitleDisplayMode(settings)).toBe(expected);
    expect(subtitleTranslationEnabled(settings)).toBe(expected === 'bilingual');
  }
});
