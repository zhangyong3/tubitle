import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from './settings';
let stored: Record<string, unknown>;
function storage(value = {}) {
  stored = value;
  vi.stubGlobal('chrome', { storage: { local: {
    get: async () => stored,
    set: async (patch: Record<string, unknown>) => { stored = { ...stored, ...patch }; },
  } } });
}
afterEach(() => vi.unstubAllGlobals());
it('defaults to Chrome Translator without sending saved personal keys', async () => {
  storage();
  expect(await getSettings()).toMatchObject({ serviceMode: 'custom', provider: 'chrome-local' });
  storage({ settings: { settingsVersion: 8, provider: 'microsoft', microsoftTranslatorKey: 'personal-key', tubitleBaseUrl: 'https://old.example', tubitleApiKey: 'old-token' } });
  expect(await getSettings()).toMatchObject({ serviceMode: 'custom', provider: 'microsoft', microsoftTranslatorKey: 'personal-key', tubitleBaseUrl: DEFAULT_SETTINGS.tubitleBaseUrl, tubitleApiKey: '' });
});
it('keeps the closed subtitle service disabled and preserves personal API configuration', async () => {
  storage();
  expect(await updateSettings({ serviceMode: 'custom', provider: 'google', googleTranslateApiKey: 'my-key', llmModel: 'my-model' })).toMatchObject({ serviceMode: 'custom', provider: 'google' });
  expect(await updateSettings({ serviceMode: 'tubitle' })).toMatchObject({ serviceMode: 'custom', provider: 'chrome-local', googleTranslateApiKey: 'my-key', llmModel: 'my-model' });
  expect(await updateSettings({ serviceMode: 'custom' })).toMatchObject({ provider: 'chrome-local', googleTranslateApiKey: 'my-key' });
});

it('migrates a previously combined custom mode and then keeps both choices independent', async () => {
  storage({ settings: { settingsVersion: 10, serviceMode: 'custom', provider: 'google' } });
  expect(await getSettings()).toMatchObject({ analysisServiceMode: 'custom', serviceMode: 'custom' });
  expect(await updateSettings({ analysisServiceMode: 'tubitle', provider: 'volcengine-free' })).toMatchObject({ analysisServiceMode: 'tubitle', serviceMode: 'custom', provider: 'volcengine-free' });
  expect(await updateSettings({ serviceMode: 'tubitle' })).toMatchObject({ analysisServiceMode: 'tubitle', serviceMode: 'custom', provider: 'chrome-local' });
  expect(await updateSettings({ analysisServiceMode: 'custom' })).toMatchObject({ analysisServiceMode: 'custom', serviceMode: 'custom' });
});

it('replaces removed experimental providers with Chrome Translator and falls back from the temporarily closed Tubitle service', async () => {
  for (const provider of ['baidu-free', 'deepl-free']) {
    storage({ settings: { settingsVersion: 12, serviceMode: 'custom', provider } });
    expect(await getSettings()).toMatchObject({ serviceMode: 'custom', provider: 'chrome-local' });
  }
  storage({ settings: { settingsVersion: 12, serviceMode: 'tubitle', provider: 'hy-mt-local' } });
  expect(await getSettings()).toMatchObject({ serviceMode: 'custom', provider: 'chrome-local' });
});
