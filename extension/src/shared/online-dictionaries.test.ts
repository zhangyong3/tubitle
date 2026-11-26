import { afterEach, expect, it, vi } from 'vitest';
import { dictionaryLanguage, dictionarySupports, normalizeOnlineDictionaries, parseYoudao, lookupOnlineDictionary, lookupDictionaryWithFallback } from './online-dictionaries';
import { dictionaryTokens, normalizeDictionaryText } from './dictionary-lookup';
afterEach(()=>vi.unstubAllGlobals());
it('preserves empty multi-selection and migrates absent settings to WordNet',()=>{
 expect(normalizeOnlineDictionaries(undefined)).toEqual(['wordnet']);
 expect(normalizeOnlineDictionaries([])).toEqual([]);
 expect(normalizeOnlineDictionaries(['youdao','bogus','bing','youdao'])).toEqual(['bing','youdao']);
});
it('uses known subtitle language rather than treating every Latin word as English',()=>{
 expect(dictionaryLanguage('bonjour','fr-FR')).toBe('fr');
 expect(dictionaryLanguage('Haus','de')).toBe('de');
 expect(dictionaryLanguage('hello')).toBe('auto');
 expect(dictionaryLanguage('こんにちは','en')).toBe('ja');
 expect(dictionaryLanguage('世界','ja')).toBe('ja');
 expect(dictionaryLanguage('안녕','en')).toBe('ko');
 expect(dictionarySupports('wordnet','fr')).toBe(false);
 expect(dictionarySupports('bing','ja')).toBe(false);
 expect(dictionarySupports('youdao','ja')).toBe(true);
 expect(dictionarySupports('youdao','de')).toBe(false);
});
it('preserves diacritics and segments languages that do not use spaces',()=>{
 expect(normalizeDictionaryText('École!')).toBe('École');
 expect(normalizeDictionaryText('हिन्दी')).toBe('हिन्दी');
 const text='私は日本語を勉強します。';const tokens=dictionaryTokens(text);
 expect(tokens.map(item=>item.value).join('')).toBe(text);
 expect(tokens.filter(item=>item.word).length).toBeGreaterThan(2);
 expect(dictionaryTokens("couldn't re-enter").filter(item=>item.word).map(item=>item.value)).toEqual(["couldn't",'re-enter']);
});
it('parses current English object and legacy array schemas',()=>{
 expect(parseYoudao({ce:{word:{trs:[{'#text':'study','#tran':'学习'}]}}},'学习','zh').senses[0]?.definitions).toEqual(['study — 学习']);
 expect(parseYoudao({ec:{word:{trs:[{pos:'v.',tran:'学习'}]}}},'learn','en').senses[0]?.definitions).toEqual(['学习']);
 expect(parseYoudao({ec:{word:[{trs:[{tr:[{l:{i:['学习']}}]}]}]}},'learn','en').senses[0]?.definitions).toEqual(['学习']);
});
it('parses French, Korean and the newer Japanese schema without using English fallback',()=>{
 const legacy={word:[{trs:[{pos:'n.',tr:[{l:{i:['你好']},exam:{i:[{f:{l:{i:['bonjour']}} ,n:{l:{i:'你好'}}}]}}]}]}]};
 for(const [language,key] of [['fr','fc'],['ko','kc']]) expect(parseYoudao({[key!]:legacy},'sample',language!).senses[0]?.definitions).toEqual(['你好']);
 expect(parseYoudao({newjc:{word:{head:{pjm:'こんにちは'},sense:[{phrList:[{jmsy:'你好',lj:['こんにちは'],ljT:['你好']}]}]}}},'こんにちは','ja').senses[0]?.definitions).toEqual(['你好']);
 expect(parseYoudao({ec:{word:{trs:[{tran:'English fallback'}]}}},'bonjour','fr').senses).toEqual([]);
});
it('does not request an unsupported language and never sends cookies or a key to Youdao',async()=>{
 const fetch=vi.fn(async()=>Response.json({fc:{word:[{trs:[{tr:[{l:{i:['你好']}}]}]}]}}));vi.stubGlobal('fetch',fetch);
 await expect(lookupOnlineDictionary('wordnet','bonjour','fr',new AbortController().signal)).rejects.toThrow('不支持');
 expect(fetch).not.toHaveBeenCalled();
 await lookupOnlineDictionary('youdao','bonjour','fr',new AbortController().signal);
 expect(fetch).toHaveBeenCalledWith(expect.stringContaining('le=fr'),expect.objectContaining({method:'GET',credentials:'omit',redirect:'error'}));
});
it('uses a bodyless Youdao GET so Chrome does not add a POST Origin rejected by Youdao',async()=>{
 const fetch=vi.fn(async (_url:string,init?:RequestInit)=>init?.method==='POST'
   ? new Response('Invalid CORS request',{status:403})
   : Response.json({ec:{word:{trs:[{pos:'n.',tran:'回归验证词条'}]}}}));
 vi.stubGlobal('fetch',fetch);
 const result=await lookupOnlineDictionary('youdao','regression-origin','en',new AbortController().signal);
 expect(result.senses[0]?.definitions).toEqual(['回归验证词条']);
 const [url,init]=fetch.mock.calls[0]!;
 const query=new URL(url).searchParams;
 expect(query.get('q')).toBe('regression-origin');
 expect(query.get('le')).toBe('en');
 expect(query.get('doctype')).toBe('json');
 expect(init?.method ?? 'GET').toBe('GET');
 expect(init?.body).toBeUndefined();
 expect(init?.credentials).toBe('omit');
});

it('falls back from empty Chinese Youdao results to its English dictionary', async () => {
 let calls=0;
 const fetch=vi.fn(async ()=>Response.json(++calls === 1 ? {} : {ec:{word:{trs:[{tran:'实际上'}]}}}));
 vi.stubGlobal('fetch',fetch);
 const result=await lookupDictionaryWithFallback('youdao','actually-fallback-regression','zh',new AbortController().signal);
 expect(result.language).toBe('en');expect(result.senses[0]?.definitions).toEqual(['实际上']);
 expect(fetch).toHaveBeenCalledTimes(2);
});
it('uses English WordNet when the selected language is unsupported', async () => {
 const fetch=vi.fn(async()=>Response.json([{partOfSpeech:'n',definition:['an alternative'],example:[]}]));
 vi.stubGlobal('fetch',fetch);
 const result=await lookupDictionaryWithFallback('wordnet','fallback-regression','zh',new AbortController().signal);
 expect(result.language).toBe('en');expect(fetch).toHaveBeenCalledOnce();
});
