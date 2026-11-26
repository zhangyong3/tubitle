import type { TranscriptPanelTab } from './types';

export function startPanelAutoReturn(
  state: { embedded: boolean; playing: boolean; tab: TranscriptPanelTab; seconds: number; analysisStatus: 'streaming' | 'done' | 'error' },
  onReturn: () => void,
): (() => void) | undefined {
  if (!state.embedded || !state.playing || state.tab === 'subtitles' || state.seconds <= 0 ||
      (state.tab === 'analysis' && state.analysisStatus === 'streaming')) return;
  const timer = setTimeout(onReturn, state.seconds * 1000);
  return () => clearTimeout(timer);
}
