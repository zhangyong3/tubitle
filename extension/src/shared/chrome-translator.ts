import { languageFamily } from './languages';
interface LocalTranslator { translate(text: string, options?: { signal?: AbortSignal }): Promise<string> }
interface TranslatorAPI {
  availability(pair: {sourceLanguage: string; targetLanguage: string}): Promise<string>;
  create(pair: {sourceLanguage: string; targetLanguage: string; monitor?: (monitor: EventTarget) => void}): Promise<LocalTranslator>;
}
const translators = new Map<string, Promise<LocalTranslator>>();
export async function translateInChrome(text: string, source: string, target: string, signal?: AbortSignal, progress?: (loaded: number) => void): Promise<string> {
  signal?.throwIfAborted();
  const api = (globalThis as unknown as {Translator?: TranslatorAPI}).Translator;
  if (!api) throw new Error('Chrome 本地翻译不可用，请使用支持 Translator API 的桌面 Chrome 138 或更新版本');
  if (!source || source === 'auto') throw new Error('Chrome 本地翻译需要已知的字幕源语言');
  const normalize = (code: string) => languageFamily(code) === 'zh' ? (/tw|hant|hk/i.test(code) ? 'zh-Hant' : 'zh') : languageFamily(code);
  const pair = { sourceLanguage: normalize(source), targetLanguage: normalize(target) };
  if (pair.sourceLanguage === pair.targetLanguage) return text;
  const key = JSON.stringify(pair);
  let pending = translators.get(key);
  if (!pending) {
    pending = (async () => {
      const availability = await api.availability(pair);
      if (availability === 'unavailable') throw new Error('Chrome 不支持此翻译语言对，请切换引擎');
      if (availability !== 'available' && !navigator.userActivation?.isActive) throw new Error('请先在视频页面点击播放，再重试以下载 Chrome 翻译语言包');
      return api.create({ ...pair, monitor: monitor => monitor.addEventListener('downloadprogress', event => progress?.((event as Event & {loaded: number}).loaded)) });
    })().catch(error => { translators.delete(key); throw error; });
    translators.set(key, pending);
  }
  const translator = await pending;
  signal?.throwIfAborted();
  const result = await translator.translate(text, { signal });
  if (!result.trim()) throw new Error('Chrome 未返回有效译文');
  return result;
}
export function requestChromeTranslation(text: string, source: string, target: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (error?: unknown, result?: string) => {
      clearTimeout(timer); document.removeEventListener('tubitle:chrome-translation', receive);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result!);
    };
    const abort = () => {
      document.dispatchEvent(new CustomEvent('tubitle:chrome-cancel', {detail:{requestId}}));
      finish(signal.reason);
    };
    const receive = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value?.requestId !== requestId) return;
      if (typeof value.error === 'string') finish(new Error(value.error));
      else if (typeof value.text === 'string' && value.text.trim() && value.text.length <= 20000) finish(undefined, value.text);
    };
    const timer = setTimeout(() => { document.dispatchEvent(new CustomEvent('tubitle:chrome-cancel', {detail:{requestId}})); finish(new Error('Chrome 本地翻译超时，请确认语言包已下载')); }, 60000);
    document.addEventListener('tubitle:chrome-translation', receive);
    signal.addEventListener('abort', abort, {once:true});
    document.dispatchEvent(new CustomEvent('tubitle:chrome-translate', {detail:{requestId, text, source, target}}));
  });
}
