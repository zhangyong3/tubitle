import { requestAccountAnalysis } from './learning-sync';
import { requestAnalysis } from './local-providers';
import type { ExtensionSettings } from './shared/types';
export function requestSentenceAnalysis(sentence: string, requestId: string, settings: ExtensionSettings, signal: AbortSignal): Promise<Response> {
  return settings.analysisServiceMode === 'custom'
    ? requestAnalysis(sentence, settings, signal)
    : requestAccountAnalysis(sentence, requestId, signal);
}
