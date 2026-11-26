import { languageFamily } from './languages';
import { translateInChrome } from './chrome-translator';
import { requestSubtitleTranslation } from './subtitle-translation';
import { getSettings } from './settings';
import type { OnlineDictionaryResult } from './online-dictionaries';

export type DictionaryTranslator = (text: string, source: string, target: string, signal: AbortSignal) => Promise<string>;

export const translateDictionaryText: DictionaryTranslator = async (text, source, target, signal) => {
  const settings = await getSettings();
  // Settings changes cancel the lookup before its result can be displayed.
  if (settings.targetLanguage !== target) throw new DOMException('Dictionary language changed', 'AbortError');
  if (settings.provider === 'chrome-local') {
    try { return await translateInChrome(text, source, target, signal); }
    catch (error) {
      if (error instanceof Error && error.message === '请先在视频页面点击播放，再重试以下载 Chrome 翻译语言包') {
        throw new Error('请点击重试以下载 Chrome 翻译语言包');
      }
      throw error;
    }
  }
  return requestSubtitleTranslation({ type: 'TRANSLATE', text, sourceLanguage: source, provider: settings.provider, priority: 'current', purpose: 'dictionary' }, signal);
};

export async function localizeDictionaryResult(result: OnlineDictionaryResult, target: string, signal: AbortSignal, translate: DictionaryTranslator = translateDictionaryText): Promise<OnlineDictionaryResult> {
  const pending = new Map<string, Promise<string>>();
  async function text(value: string): Promise<string> {
    signal.throwIfAborted();
    if (!value.trim()) return value;
    const source = /\p{Script=Han}/u.test(value) ? 'zh' : 'en';
    if (source === target || (source !== 'zh' && source === languageFamily(target))) return value;
    let request = pending.get(value);
    if (!request) {
      request = translate(value, source, target, signal).then(translated => {
        signal.throwIfAborted();
        if (!translated.trim()) throw new Error('翻译服务未返回有效译文，请切换引擎后重试');
        return translated;
      });
      pending.set(value, request);
    }
    return request;
  }
  const senses = [];
  for (const sense of result.senses) {
    const definitions = [];
    for (const definition of sense.definitions) definitions.push(await text(definition));
    const examples = [];
    for (const example of sense.examples) {
      const [original, ...translations] = example.split(' — ');
      examples.push(translations.length ? [original, await text(translations.join(' — '))].join(' — ') : await text(example));
    }
    const partOfSpeech = /\p{Script=Han}/u.test(sense.partOfSpeech) ? await text(sense.partOfSpeech) : sense.partOfSpeech;
    senses.push({ partOfSpeech, definitions, examples });
  }
  signal.throwIfAborted();
  return { ...result, senses };
}
