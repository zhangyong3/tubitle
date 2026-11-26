import type { TranslationProvider } from './types';
// Subtitle service entry is temporarily closed; retain the provider and server implementation.
export const TUBITLE_SUBTITLE_SERVICE_ENABLED = false;
export type ServiceMode = 'tubitle' | 'custom';
export function serviceMode(value: unknown): ServiceMode { return value === 'custom' ? 'custom' : 'tubitle'; }
export const KEYLESS_PROVIDERS = [
  ["chrome-local", "Chrome Translator"], ["edge-free", "Microsoft Edge"], ["google-free", "Google"],
  ["volcengine-free", "Volcengine"], ["tencent-free", "Tencent Transmart"],
] as const;
export function isKeylessProvider(provider: string): boolean {
  return KEYLESS_PROVIDERS.some(([id]) => id === provider);
}
export function translationProvider(mode: unknown, provider: TranslationProvider): TranslationProvider {
  return serviceMode(mode) === 'tubitle' ? 'hy-mt-local' : provider === 'microsoft' || provider === 'google' || isKeylessProvider(provider) ? provider : 'chrome-local';
}
