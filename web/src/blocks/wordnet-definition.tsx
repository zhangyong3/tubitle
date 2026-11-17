import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import {
  WORDNET_NAME, WORDNET_SITE, WORDNET_COPYRIGHT, WORDNET_LICENSE,
  PRINCETON_NOTICE, PRINCETON_LICENSE, type WordNetLookup,
} from '@/lib/wordnet';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';

export function WordNetDefinition({ word }: { word: string }) {
  const query = useQuery({
    queryKey: ['wordnet', word.trim().toLowerCase()],
    queryFn: ({ signal }) => apiGet<WordNetLookup>(`/api/wordnet?${new URLSearchParams({ word })}`, { signal }),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  return <section className="tt-study-wordnet" aria-label={WORDNET_NAME}>
    <h3>{WORDNET_NAME}</h3>
    <div aria-live="polite">
      {query.isPending ? <p className="tt-study-source" role="status">{m['tubitle.wordnet.loading']()}</p>
        : query.isError ? <div className="tt-study-wordnet-error"><p>{m['tubitle.wordnet.error']()}</p><Button variant="ghost" onClick={() => void query.refetch()}>{m['tubitle.library.retry']()}</Button></div>
        : !query.data.senses.length ? <p className="tt-study-source">{m['tubitle.wordnet.empty']()}</p>
        : <>
          {query.data.lemma !== word.trim().toLowerCase() && <p className="tt-study-source">{m['tubitle.wordnet.lemma']({ lemma: query.data.lemma })}</p>}
          <ol lang="en">{query.data.senses.map((sense, index) => <li key={index}>
            {sense.partOfSpeech && <span className="tt-study-wordnet-pos">{sense.partOfSpeech}</span>}
            {sense.definitions.map((definition, i) => <p key={i}>{definition}</p>)}
            {sense.examples.map((example, i) => <blockquote key={i}>“{example}”</blockquote>)}
          </li>)}</ol>
        </>}
    </div>
    {!!query.data?.senses.length && <details className="tt-study-wordnet-credit">
      <summary>{m['tubitle.wordnet.license']()}</summary>
      <p><a href={WORDNET_SITE} target="_blank" rel="noopener noreferrer">{WORDNET_NAME}</a> · {WORDNET_COPYRIGHT} <a href={WORDNET_LICENSE} target="_blank" rel="noopener noreferrer">CC BY 4.0</a> · {m['tubitle.wordnet.adaptation']()}</p>
      <p lang="en">{PRINCETON_NOTICE}</p>
      <a href={PRINCETON_LICENSE} target="_blank" rel="noopener noreferrer">Princeton WordNet</a>
    </details>}
  </section>;
}
