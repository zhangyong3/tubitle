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

export async function lookupWordNet(word: string, signal: AbortSignal): Promise<WordNetSense[]> {
  const lemma = normalizeDictionaryWord(word);
  if (!lemma) return [];
  const response = await fetch(`${WORDNET_SITE}/api/lemma/${encodeURIComponent(lemma)}`, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)])
  });
  if (!response.ok) throw new Error(`WordNet HTTP ${response.status}`);
  return parseSynsets(await response.json());
}

