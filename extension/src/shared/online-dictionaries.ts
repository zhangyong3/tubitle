import { lookupWordNet } from './wordnet';
export const ONLINE_DICTIONARIES = [
  ['bing', '必应词典', 'https://www.bing.com/*'],
  ['youdao', '有道词典', 'https://dict.youdao.com/*'],
  ['wordnet', 'Open English WordNet', 'https://en-word.net/*'],
] as const;
export type OnlineDictionary = typeof ONLINE_DICTIONARIES[number][0];
export function normalizeOnlineDictionaries(value: unknown): OnlineDictionary[] {
  if (!Array.isArray(value)) return ['wordnet'];
  return ONLINE_DICTIONARIES.flatMap(([id]) => value.includes(id) ? [id] : []);
}
export function dictionaryLanguage(word: string, track = ''): string {
  if (/[\u3040-\u30ff]/u.test(word)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(word)) return 'ko';
  if (/\p{Script=Cyrillic}/u.test(word)) return track.split('-')[0] === 'uk' ? 'uk' : 'ru';
  if (/\p{Script=Arabic}/u.test(word)) return 'ar';
  if (/\p{Script=Thai}/u.test(word)) return 'th';
  if (/\p{Script=Han}/u.test(word)) return /^(ja|zh)/i.test(track) ? track.split('-')[0]!.toLowerCase() : 'zh';
  // Latin spelling alone cannot distinguish English, French, German, etc.
  return track.toLowerCase().split('-')[0] || 'auto';
}
export function dictionarySupports(provider: OnlineDictionary, language: string): boolean {
  return provider === 'wordnet' ? language === 'en' : provider === 'bing' ? ['en', 'zh'].includes(language) : ['en', 'zh', 'ja', 'ko', 'fr'].includes(language);
}
export interface OnlineSense { partOfSpeech: string; definitions: string[]; examples: string[] }
export interface OnlineDictionaryResult { lemma: string; senses: OnlineSense[]; phonetics?: string[] }
const array = (value: any): any[] => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
const texts = (value: unknown): string[] => typeof value === 'string' && value.trim() ? [value.trim()] : Array.isArray(value) ? value.flatMap(texts) : [];
function limit(result: OnlineDictionaryResult): OnlineDictionaryResult {
  return { ...result, lemma: result.lemma.slice(0,200), senses: result.senses.slice(0,20).map(sense => ({partOfSpeech:sense.partOfSpeech.slice(0,100),definitions:sense.definitions.slice(0,8).map(text=>text.slice(0,2000)),examples:sense.examples.slice(0,3).map(text=>text.slice(0,2000))})), phonetics: result.phonetics?.slice(0,3) };
}
export function parseYoudao(data: any, word: string, language: string): OnlineDictionaryResult {
  const key = ({en:'ec',zh:'ce',fr:'fc',ja:'newjc',ko:'kc'} as Record<string,string>)[language];
  const entry = (key ? data?.[key] : undefined) || (language === 'ja' ? data?.jc : undefined);
  const senses: OnlineSense[] = [];
  let lemma = word;
  const phonetics: string[] = [];
  for (const item of array(entry?.word)) {
    const phrase = item['return-phrase'];
    lemma = texts(typeof phrase === 'string' ? phrase : phrase?.l?.i)[0] || lemma;
    phonetics.push(...texts(item.ukphone).map(x=>`UK /${x}/`),...texts(item.usphone).map(x=>`US /${x}/`),...texts(item.phone));
    if (language === 'ja' && item.head) {
      lemma = typeof item.head.pjm === 'string' ? item.head.pjm : word;
      phonetics.push(...texts(item.head.rs));
      for (const sense of array(item.sense)) for (const phrase of array(sense.phrList)) {
        const definitions = texts(phrase.jmsy);
        const originals = texts(phrase.lj), translated = texts(phrase.ljT);
        if (definitions.length) senses.push({partOfSpeech:'',definitions,examples:originals.map((text,index)=>[text,translated[index]].filter(Boolean).join(' — '))});
      }
    }
    for (const sense of array(item.trs)) {
      const definitions = texts(sense.tran);
      if (language === 'zh') definitions.push(...texts(sense['#text']).map(text => [text, ...texts(sense['#tran'])].join(' — ')));
      const examples: string[] = [];
      for (const tr of array(sense.tr)) {
        definitions.push(...texts(tr.l?.i));
        for (const ex of array(tr.exam?.i)) examples.push([...texts(ex.f?.l?.i),...texts(ex.n?.l?.i)].join(' — '));
      }
      if (definitions.length) senses.push({partOfSpeech:typeof sense.pos==='string'?sense.pos:'',definitions,examples});
    }
  }
  return limit({lemma,senses,phonetics});
}
export function parseBing(doc: ParentNode, word: string): OnlineDictionaryResult {
  const lemma = doc.querySelector('#headword h1')?.textContent?.trim() || '';
  if (!lemma) throw new Error('词典暂不可用或页面结构已改变');
  const senses = [...doc.querySelectorAll('.qdef > ul > li')].flatMap(node=>{
    const definition=node.querySelector('.def')?.textContent?.trim();
    return definition ? [{partOfSpeech:node.querySelector('.pos')?.textContent?.trim() || '',definitions:[definition],examples:[] as string[]}] : [];
  });
  const examples=[...doc.querySelectorAll('#sentenceSeg .se_li')].slice(0,3).map(node=>[node.querySelector('.sen_en')?.textContent?.trim(),node.querySelector('.sen_cn')?.textContent?.trim()].filter(Boolean).join(' — '));
  if(senses[0]) senses[0].examples=examples;
  const phonetics=[...doc.querySelectorAll('.hd_pr, .hd_prUS')].map(node=>node.textContent?.trim() || '').filter(Boolean);
  return limit({lemma:lemma || word,senses,phonetics});
}
export function dictionaryUrl(provider: OnlineDictionary, word: string, language: string): string {
  if(provider==='bing') return `https://www.bing.com/dict/search?${new URLSearchParams({q:word,FORM:'BDVSP6',cc:'cn'})}`;
  if(provider==='youdao') return `https://dict.youdao.com/result?${new URLSearchParams({word,lang:language==='zh'?'en':language})}`;
  return `https://en-word.net/lemma/${encodeURIComponent(word)}`;
}
const cache = new Map<string,{at:number;result:OnlineDictionaryResult}>();
export async function lookupOnlineDictionary(provider: OnlineDictionary, word: string, language: string, signal: AbortSignal): Promise<OnlineDictionaryResult> {
  signal.throwIfAborted();
  if(!dictionarySupports(provider,language)) throw new Error('此词典不支持所选词条语言');
  if(!word.trim() || word.length>150) throw new Error('词条过长，请选择单词或短语');
  const key=JSON.stringify([provider,language,word]);
  const cached=cache.get(key);if(cached && Date.now()-cached.at<30*60*1000) return cached.result;
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
  let result:OnlineDictionaryResult;
  if(provider==='wordnet') result=await lookupWordNet(word,deadline);
  else {
    // A POST from Chrome carries the extension Origin, which Youdao rejects
    // with HTTP 403 "Invalid CORS request". Its dictionary endpoint also accepts
    // GET; a bodyless GET from an extension with host permission avoids that
    // POST-specific Origin header without rewriting any browser headers.
    const url = provider === 'bing' ? dictionaryUrl(provider, word, language)
      : `https://dict.youdao.com/jsonapi_s?${new URLSearchParams({
        doctype: 'json', jsonversion: '4', q: word,
        le: language === 'zh' ? 'en' : language, t: '3', client: 'web', keyfrom: 'webdict',
      })}`;
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'error', signal: deadline,
    });
    if(!response.ok) throw new Error('词典暂不可用，请稍后重试');
    if(provider==='youdao') result=parseYoudao(await response.json(),word,language);
    else {
      const html=await response.text();
      if(html.length>3_000_000) throw new Error('词典响应过大');
      // Template content is inert; remote HTML is never attached to the page.
      const template=document.createElement('template');template.innerHTML=html;
      result=parseBing(template.content,word);
    }
  }
  signal.throwIfAborted();
  if(result.senses.length) {if(cache.size>=300)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),result});}
  return result;
}
