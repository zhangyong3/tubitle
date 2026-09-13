export interface DictionaryCandidate {
  word: string;
  offset: number;
}

export function normalizeDictionaryWord(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}'-]/gu, "")
    .replace(/^['-]+|['-]+$/g, "")
    .toLowerCase();
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
