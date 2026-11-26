import { afterEach, expect, it, vi } from 'vitest';
import { localizeDictionaryResult, translateDictionaryText } from './dictionary-translation';
import { parseYoudao, type OnlineDictionaryResult } from './online-dictionaries';
import { DEFAULT_SETTINGS } from './settings';

const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
const bing: OnlineDictionaryResult = { lemma: 'learn', phonetics: ['/lɜːn/'], senses: [{ partOfSpeech: 'v.', definitions: ['学习'], examples: ['I learn Japanese. — 我学习日语。'] }] };

it('renders Bing and Youdao definitions in Japanese while retaining the original example and pronunciation', async () => {
  const youdao = parseYoudao({ ec: { word: { trs: [{ pos: 'v.', tran: '学习' }] } } }, 'learn', 'en');
  for (const raw of [bing, youdao]) {
    const translate = vi.fn(async (text: string) => text === '学习' ? '学ぶ' : '私は日本語を学びます。');
    const result = await localizeDictionaryResult(raw, 'ja', signal(), translate);
    expect(result.senses[0]?.definitions).toEqual(['学ぶ']);
    expect(translate).toHaveBeenCalledWith('学习', 'zh', 'ja', expect.any(AbortSignal));
    expect(raw.senses[0]?.definitions).toEqual(['学习']);
    expect(result.lemma).toBe('learn');
    if (raw === bing) {
      expect(result.phonetics).toEqual(['/lɜːn/']);
      expect(result.senses[0]?.examples).toEqual(['I learn Japanese. — 私は日本語を学びます。']);
    }
  }
});

it('relocalizes cached raw definitions when the target changes and preserves Traditional Chinese', async () => {
  const translate = vi.fn(async (_text: string, _source: string, target: string) => target === 'ja' ? '学ぶ' : target === 'zh-TW' ? '學習' : 'learn');
  for (const [target, expected] of [['ja', '学ぶ'], ['en', 'learn'], ['zh-TW', '學習']]) {
    expect((await localizeDictionaryResult(bing, target!, signal(), translate)).senses[0]?.definitions).toEqual([expected]);
  }
  translate.mockClear();
  expect((await localizeDictionaryResult(bing, 'zh', signal(), translate)).senses[0]?.definitions).toEqual(['学习']);
  expect(translate).not.toHaveBeenCalled();
});

it('fails explicitly instead of showing the wrong language when translation fails, is empty, or is cancelled', async () => {
  await expect(localizeDictionaryResult(bing, 'ja', signal(), async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  await expect(localizeDictionaryResult(bing, 'ja', signal(), async () => '')).rejects.toThrow('有效译文');
  const controller = new AbortController();
  controller.abort();
  const translate = vi.fn();
  await expect(localizeDictionaryResult(bing, 'ja', controller.signal, translate)).rejects.toThrow();
  expect(translate).not.toHaveBeenCalled();
});

it('uses the selected Chrome Translator with the exact target from settings', async () => {
  const translate = vi.fn(async () => '学ぶ');
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ settings: { ...DEFAULT_SETTINGS, targetLanguage: 'ja' } }) } } });
  vi.stubGlobal('Translator', { availability: async () => 'available', create: async () => ({ translate }) });
  expect(await translateDictionaryText('学习', 'zh', 'ja', signal())).toBe('学ぶ');
  expect(translate).toHaveBeenCalledWith('学习', { signal: expect.any(AbortSignal) });
});
