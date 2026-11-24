import type { ExtensionSettings, TranslationProvider } from './types';
export type ServiceMode = 'tubitle' | 'custom';
export function serviceMode(value: unknown): ServiceMode { return value === 'custom' ? 'custom' : 'tubitle'; }
export const KEYLESS_PROVIDERS = [
  ["edge-free", "Microsoft Edge"], ["google-free", "Google"],
  ["volcengine-free", "Volcengine"], ["tencent-free", "Tencent Transmart"],
  ["baidu-free", "Baidu"], ["deepl-free", "DeepL"], ["chrome-local", "Chrome Translator"],
] as const;
export function isKeylessProvider(provider: string): boolean {
  return KEYLESS_PROVIDERS.some(([id]) => id === provider);
}
export function translationProvider(mode: unknown, provider: TranslationProvider): TranslationProvider {
  return serviceMode(mode) === 'tubitle' ? 'hy-mt-local' : provider === 'google' || isKeylessProvider(provider) ? provider : 'microsoft';
}
