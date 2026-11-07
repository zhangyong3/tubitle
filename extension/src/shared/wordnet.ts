import { normalizeDictionaryWord } from "./dictionary-lookup";

export const WORDNET_NAME = "Open English WordNet";
export const WORDNET_SITE = "https://en-word.net";
export const WORDNET_LICENSE = "https://creativecommons.org/licenses/by/4.0/";
export const PRINCETON_LICENSE = "https://github.com/globalwordnet/english-wordnet/blob/main/WNDB_License.txt";
export const WORDNET_COPYRIGHT = "© 2019–present The Open English WordNet Team.";
export const PRINCETON_COPYRIGHT = "WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.";
export const PRINCETON_NOTICE = [
  "Permission to use, copy, modify and distribute this software and database and its documentation for any purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and documentation, including modifications that you make for internal use or for distribution.",
  PRINCETON_COPYRIGHT,
  'THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.',
  "The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to distribution of the software and/or database. Title to copyright in this software, database and any associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same."
].join("\n\n");

export interface WordNetSense {
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
}

export interface WordNetLookup {
  lemma: string;
  senses: WordNetSense[];
}

type InflectedPart = "noun" | "verb";
type LemmaCandidate = { lemma: string; parts: readonly InflectedPart[] };
const irregularNouns = new Map(Object.entries({
  children: "child", feet: "foot", geese: "goose", men: "man", mice: "mouse", teeth: "tooth", women: "woman"
}));
const irregularVerbs = new Map(Object.entries({
  ate: "eat", eaten: "eat", bought: "buy", did: "do", does: "do", done: "do", gone: "go", went: "go",
  had: "have", has: "have", made: "make", ran: "run", said: "say", seen: "see", saw: "see",
  took: "take", taken: "take", was: "be", were: "be", written: "write", wrote: "write"
}));

function inflectionCandidates(word: string): LemmaCandidate[] {
  if (!/^[a-z]+$/.test(word)) return [];
  const candidates = new Map<string, InflectedPart[]>();
  function add(lemma: string | undefined, ...parts: InflectedPart[]) {
    if (!lemma || lemma.length < 2 || lemma === word) return;
    candidates.set(lemma, [...new Set([...(candidates.get(lemma) ?? []), ...parts])]);
  }

  add(irregularNouns.get(word), "noun");
  add(irregularVerbs.get(word), "verb");
  if (word.endsWith("ed") || word.endsWith("ing")) {
    const isPast = word.endsWith("ed");
    const stem = word.slice(0, isPast ? -2 : -3);
    if (word.endsWith("ied")) add(word.slice(0, -3) + "y", "verb");
    if (/^[dlt]ying$/.test(word)) add(word.slice(0, -4) + "ie", "verb");
    if (/([bdgklmnprstz])\1$/.test(stem)) add(stem.slice(0, -1), "verb");
    // An undoubled short stem may have lost a silent e: hoping → hope, not hop.
    const prefersSilentE = isPast ? /[^aeiouy]$/.test(stem) : /^[^aeiou]+[aeiou][bdgklmnprstz]$/.test(stem);
    if (prefersSilentE) add(stem + "e", "verb");
    add(stem, "verb");
    add(stem + "e", "verb");
  } else if (word.endsWith("s") && !word.endsWith("ss")) {
    if (word.endsWith("ies")) add(word.slice(0, -3) + "y", "noun", "verb");
    if (word.endsWith("zzes")) add(word.slice(0, -3), "noun", "verb");
    add(word.slice(0, -1), "noun", "verb");
    if (/(?:[sxzo]|ch|sh)es$/.test(word)) add(word.slice(0, -2), "noun", "verb");
  }
  return [...candidates].map(([lemma, parts]) => ({ lemma, parts }));
}

const partsOfSpeech: Readonly<Record<string, string>> = {
  n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb"
};

function nonemptyStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
}

function parseSynsets(payload: unknown): WordNetSense[] {
  if (!Array.isArray(payload)) throw new Error("Invalid WordNet response");
  return payload.flatMap((value): WordNetSense[] => {
    if (!value || typeof value !== "object") return [];
    const entry = value as Record<string, unknown>;
    const definitions = nonemptyStrings(entry.definition);
    if (!definitions.length) return [];
    return [{
      partOfSpeech: typeof entry.partOfSpeech === "string" && Object.hasOwn(partsOfSpeech, entry.partOfSpeech)
        ? partsOfSpeech[entry.partOfSpeech]! : "",
      definitions,
      examples: nonemptyStrings(entry.example)
    }];
  });
}

async function fetchWordNetSenses(lemma: string, signal: AbortSignal): Promise<WordNetSense[]> {
  signal.throwIfAborted();
  const response = await fetch(`${WORDNET_SITE}/api/lemma/${encodeURIComponent(lemma)}`, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    signal
  });
  if (!response.ok) throw new Error(`WordNet HTTP ${response.status}`);
  return parseSynsets(await response.json());
}

export async function lookupWordNet(word: string, signal: AbortSignal): Promise<WordNetLookup> {
  const lemma = normalizeDictionaryWord(word);
  if (!lemma) return { lemma, senses: [] };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  const exact = await fetchWordNetSenses(lemma, deadline);
  if (exact.length) return { lemma, senses: exact };

  for (const candidate of inflectionCandidates(lemma)) {
    const senses = (await fetchWordNetSenses(candidate.lemma, deadline))
      .filter(({ partOfSpeech }) => candidate.parts.some((part) => part === partOfSpeech));
    if (senses.length) return { lemma: candidate.lemma, senses };
  }
  return { lemma, senses: [] };
}

