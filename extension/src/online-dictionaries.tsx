import { localizeDictionaryResult } from "./shared/dictionary-translation";
import { persistDictionarySnapshot } from "./shared/dictionary-snapshots";
import { useEffect, useState } from 'react';
import { t } from './shared/i18n';
import { ONLINE_DICTIONARIES, dictionaryUrl, lookupDictionaryWithFallback, type OnlineDictionary, type OnlineDictionaryResult } from './shared/online-dictionaries';
import { saveWordNetLookup } from './shared/sidebar-history';
import { WORDNET_NAME, WORDNET_SITE, WORDNET_COPYRIGHT, WORDNET_LICENSE, PRINCETON_NOTICE, PRINCETON_LICENSE } from './shared/wordnet';
interface State { result?: OnlineDictionaryResult; error?: string; language?: string }
export function OnlineDictionaries({word,language,targetLanguage,providers,historyDays,recordId}:{word:string;language:string;targetLanguage:string;providers:OnlineDictionary[];historyDays:number;recordId?:string}) {
  const [states,setStates]=useState<Partial<Record<OnlineDictionary,State>>>({});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setStates({});
    for(const provider of providers){
      void (async()=>{
        const raw=await lookupDictionaryWithFallback(provider,word,language,controller.signal);
        const result = provider === "wordnet" ? raw : { ...await localizeDictionaryResult(raw, targetLanguage, controller.signal), language: raw.language };
        if (!controller.signal.aborted) setStates(current => ({ ...current, [provider]: { result, language: result.language } }));
        if(provider==='wordnet' && result.senses.length && !controller.signal.aborted) await saveWordNetLookup(word,result,historyDays).catch(()=>undefined);
        if (recordId && result.senses.length && !controller.signal.aborted) {
          const name = ONLINE_DICTIONARIES.find(([id]) => id === provider)![1];
          const senses = result.senses.slice(0, 6).map(sense => ({ partOfSpeech: sense.partOfSpeech, definitions: sense.definitions.slice(0, 3).map(text => text.slice(0, 300)), examples: sense.examples.slice(0, 1).map(text => text.slice(0, 300)) }));
          await persistDictionarySnapshot(word, { provider, name, language: provider === "wordnet" ? "en" : targetLanguage, lemma: result.lemma, phonetics: result.phonetics?.map(text => text.slice(0, 200)), senses }, historyDays, recordId).catch(() => undefined);
        }
        return result;
      })().then(result=>{if(!controller.signal.aborted)setStates(current=>({...current,[provider]:{result,language:result.language}}));},error=>{if(!controller.signal.aborted)setStates(current=>({...current,[provider]:{error:error instanceof Error?error.message:'词典暂不可用，请稍后重试'}}));});
    }
    return ()=>controller.abort();
  },[word,language,targetLanguage,providers,historyDays,retry,recordId]);
  if(!providers.length) return <p className="status empty">{t('未启用在线词典，可在设置中多选词典。')}</p>;
  return <>{providers.map(provider=>{
    const state=states[provider];const result=state?.result;
    const name=ONLINE_DICTIONARIES.find(([id])=>id===provider)![1];
    return <section key={provider} className="dictionary-source" aria-label={t(name)}>
      <div className="dictionary-source-heading"><h2>{t(name)}</h2><a className="dictionary-external" href={dictionaryUrl(provider,word,state?.language || language)} target="_blank" rel="noopener noreferrer" title={t('在词典网站查看')} aria-label={t('在词典网站查看')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></a></div>
      {state?.error ? <div className="status error" role="alert">{t(state.error)} <button type="button" onClick={()=>setRetry(value=>value+1)}>{t('重试')}</button></div>
      : !result ? <p className="status" role="status">{t('正在查询词典…')}</p>
      : !result.senses.length ? <p className="status empty">{t('此词典中没有找到词条，可尝试原形或切换语言。')}</p>
      : <>
        {result.lemma!==word && <p className="brand">{t('按原形查到：')}<strong>{result.lemma}</strong></p>}
        {!!result.phonetics?.length && <p className="brand">{result.phonetics.join(' · ')}</p>}
        <ol className="wordnet-senses">{result.senses.map((sense,index)=><li key={index}>
          {sense.partOfSpeech && <span className="wordnet-pos">{sense.partOfSpeech}</span>}
          {sense.definitions.map((text,index)=><div key={index}>{text}</div>)}
          {sense.examples.map((text,index)=><blockquote key={index}>{text}</blockquote>)}
        </li>)}</ol>
      </>}

      {provider==='wordnet' && <details className="dictionary-credit"><summary>{t('WordNet 版权与许可 · CC BY 4.0')}</summary>
        <p><a href={WORDNET_SITE} target="_blank" rel="noopener noreferrer">{WORDNET_NAME}</a> · {WORDNET_COPYRIGHT} <a href={WORDNET_LICENSE} target="_blank" rel="noopener noreferrer">CC BY 4.0</a>{t('· 节选释义和例句，重新排版。')}</p>
        <p lang="en">{PRINCETON_NOTICE}</p><a href={PRINCETON_LICENSE} target="_blank" rel="noopener noreferrer">{t('Princeton WordNet 许可原文')}</a>
      </details>}
    </section>;
  })}</>;
}
