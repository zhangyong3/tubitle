import type { ExtensionSettings, TranslationProvider } from './types';
export type ServiceMode = 'tubitle' | 'custom';
export function serviceMode(value: unknown): ServiceMode { return value === 'custom' ? 'custom' : 'tubitle'; }
export function translationProvider(mode: unknown, provider: TranslationProvider): TranslationProvider {
  return serviceMode(mode) === 'tubitle' ? 'hy-mt-local' : provider === 'google' ? 'google' : 'microsoft';
}
