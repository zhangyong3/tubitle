import { readDictionarySnapshots } from '@/lib/dictionary-snapshots';
import { WORDNET_NAME, WORDNET_SITE, WORDNET_COPYRIGHT, WORDNET_LICENSE, PRINCETON_NOTICE, PRINCETON_LICENSE } from '@/lib/wordnet';
import { m } from '@/paraglide/messages.js';
export function SavedDictionaries({ value }: { value: string }) {
  return <>{readDictionarySnapshots(value).map(source => <section className="tt-study-wordnet" key={source.provider} aria-label={source.name}>
    <h3>{source.name}</h3>
    <p className="tt-study-source" lang={source.language}>{source.lemma}{source.phonetics?.length ? ` · ${source.phonetics.join(' · ')}` : ''}</p>
    <ol>{source.senses.map((sense, index) => <li key={index}>
      {sense.partOfSpeech && <span className="tt-study-wordnet-pos">{sense.partOfSpeech}</span>}
      {sense.definitions.map((text, index) => <p style={{ whiteSpace: 'pre-wrap' }} key={index}>{text}</p>)}
      {sense.examples.map((text, index) => <blockquote key={index}>{text}</blockquote>)}
    </li>)}</ol>
    {source.provider === 'wordnet' && <details className="tt-study-wordnet-credit"><summary>{m['tubitle.wordnet.license']()}</summary><p><a href={WORDNET_SITE} target="_blank" rel="noopener noreferrer">{WORDNET_NAME}</a> · {WORDNET_COPYRIGHT} <a href={WORDNET_LICENSE} target="_blank" rel="noopener noreferrer">CC BY 4.0</a> · {m['tubitle.wordnet.adaptation']()}</p><p lang="en">{PRINCETON_NOTICE}</p><a href={PRINCETON_LICENSE} target="_blank" rel="noopener noreferrer">Princeton WordNet</a></details>}
  </section>)}</>;
}
