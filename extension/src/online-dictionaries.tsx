import { useEffect, useState } from 'react';
import { t } from './shared/i18n';
import { ONLINE_DICTIONARIES, dictionarySupports, dictionaryUrl, lookupOnlineDictionary, type OnlineDictionary, type OnlineDictionaryResult } from './shared/online-dictionaries';
import { getSidebarHistory, saveWordNetLookup } from './shared/sidebar-history';
import { normalizeDictionaryWord } from './shared/dictionary-lookup';
import { WORDNET_NAME, WORDNET_SITE, WORDNET_COPYRIGHT, WORDNET_LICENSE, PRINCETON_NOTICE, PRINCETON_LICENSE } from './shared/wordnet';
interface State { result?: OnlineDictionaryResult; error?: string; unsupported?: boolean }
export function OnlineDictionaries({word,language,providers,historyDays}:{word:string;language:string;providers:OnlineDictionary[];historyDays:number}) {
  const [states,setStates]=useState<Partial<Record<OnlineDictionary,State>>>({});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setStates({});
    for(const provider of providers){
      if(!dictionarySupports(provider,language)){setStates(current=>({...current,[provider]:{unsupported:true}}));continue;}
      void (async()=>{
        if(provider==='wordnet'){
          const entries=await getSidebarHistory().catch(()=>[]);
          const entry=entries.find(entry=>entry.type==='dictionary' && normalizeDictionaryWord(entry.word)===normalizeDictionaryWord(word));
          if(entry?.type==='dictionary' && entry.wordNet?.length) return {lemma:entry.wordNetLemma || word,senses:entry.wordNet};
        }
        const result=await lookupOnlineDictionary(provider,word,language,controller.signal);
        if(provider==='wordnet' && result.senses.length && !controller.signal.aborted) await saveWordNetLookup(word,result,historyDays).catch(()=>undefined);
        return result;
      })().then(result=>{if(!controller.signal.aborted)setStates(current=>({...current,[provider]:{result}}));},error=>{if(!controller.signal.aborted)setStates(current=>({...current,[provider]:{error:error instanceof Error?error.message:'词典暂不可用，请稍后重试'}}));});
    }
    return ()=>controller.abort();
  },[word,language,providers,historyDays,retry]);
  if(!providers.length) return <p className="status empty">{t('未启用在线词典，可在设置中多选词典。')}</p>;
  return <>{providers.map(provider=>{
    const state=states[provider];const result=state?.result;
    const name=ONLINE_DICTIONARIES.find(([id])=>id===provider)![1];
    return <section key={provider} className="dictionary-source" aria-label={t(name)}>
      <h2>{t(name)}</h2>
      {state?.unsupported ? <p className="status empty">{language==='auto'?t('无法确定词条语言，请先选择语言。'):t('此词典不支持所选词条语言。')} {provider==='wordnet'?t('Open English WordNet 仅收录英语。'):provider==='bing'?t('必应词典主要支持英语和中文查询。'):t('有道词典支持英、中、日、韩、法语查询。')}</p>
      : state?.error ? <div className="status error" role="alert">{t(state.error)} <button type="button" onClick={()=>setRetry(value=>value+1)}>{t('重试')}</button></div>
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
      <a className="dictionary-link" href={dictionaryUrl(provider,word,language)} target="_blank" rel="noopener noreferrer">{t('在词典网站查看')} ↗</a>
      {provider==='wordnet' && <details className="dictionary-credit"><summary>{t('WordNet 版权与许可 · CC BY 4.0')}</summary>
        <p><a href={WORDNET_SITE} target="_blank" rel="noopener noreferrer">{WORDNET_NAME}</a> · {WORDNET_COPYRIGHT} <a href={WORDNET_LICENSE} target="_blank" rel="noopener noreferrer">CC BY 4.0</a>{t('· 节选释义和例句，重新排版。')}</p>
        <p lang="en">{PRINCETON_NOTICE}</p><a href={PRINCETON_LICENSE} target="_blank" rel="noopener noreferrer">{t('Princeton WordNet 许可原文')}</a>
      </details>}
    </section>;
  })}</>;
}
