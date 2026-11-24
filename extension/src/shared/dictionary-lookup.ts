export interface DictionaryCandidate {
  word: string;
  offset: number;
}

export function normalizeDictionaryText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{M}'\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/^['-]+|['-]+$/g, "");
}

export function selectDictionaryCandidates(query: string, candidates: DictionaryCandidate[]) {
  const normalized = normalizeDictionaryWord(query);
  const suggestions = [...new Set(
    candidates.slice(0, 12).map((candidate) => candidate.word).filter(Boolean)
  )].slice(0, 8);
  const exact = candidates.find(
    (candidate) => normalizeDictionaryWord(candidate.word) === normalized
  );
  return { normalized, exact, suggestions };
}

export function normalizeDictionaryWord(value: string): string {
  return normalizeDictionaryText(value).toLowerCase();
}
export function dictionaryTokens(text: string): Array<{value:string;word:boolean}> {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(text) && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)].map(item=>({value:item.segment,word:Boolean(item.isWordLike)}));
  }
  return (text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu) ?? []).map(value=>({value,word:/^[\p{L}\p{M}]/u.test(value)}));
}
