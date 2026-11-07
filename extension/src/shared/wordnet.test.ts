import { afterEach, expect, it, vi } from "vitest";
import { lookupWordNet } from "./wordnet";

const synset = (partOfSpeech: string, text: string) => ({ partOfSpeech, definition: [text] });

function mockWordNet(entries: Record<string, ReturnType<typeof synset>[]>) {
  const queries: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const lemma = decodeURIComponent(new URL(url).pathname.split("/").at(-1)!);
    queries.push(lemma);
    return Response.json(entries[lemma] ?? []);
  }));
  return queries;
}

afterEach(() => vi.unstubAllGlobals());

it("preserves an exact entry even when its spelling looks inflected", async () => {
  const queries = mockWordNet({ running: [synset("n", "the act of running")], run: [synset("v", "move fast")] });
  expect(await lookupWordNet("Running", new AbortController().signal)).toMatchObject({
    lemma: "running", senses: [{ partOfSpeech: "noun", definitions: ["the act of running"] }]
  });
  expect(queries).toEqual(["running"]);
});

it.each([
  ["worked", "work", "v"], ["danced", "dance", "v"], ["tried", "try", "v"],
  ["hopping", "hop", "v"], ["making", "make", "v"], ["dying", "die", "v"],
  ["books", "book", "n"], ["boxes", "box", "n"], ["studies", "study", "n"],
  ["children", "child", "n"], ["went", "go", "v"]
])("finds %s under %s after an exact miss", async (word, lemma, pos) => {
  const queries = mockWordNet({ [lemma]: [synset(pos, "matching sense"), synset("a", "unrelated adjective")] });
  const result = await lookupWordNet(word, new AbortController().signal);
  expect(result).toMatchObject({ lemma, senses: [{ definitions: ["matching sense"] }] });
  expect(queries[0]).toBe(word);
  expect(queries.at(-1)).toBe(lemma);
});

it("continues to the next spelling when a candidate has only the wrong part of speech", async () => {
  const queries = mockWordNet({ worke: [synset("n", "a noun")], work: [synset("v", "to labor")] });
  expect(await lookupWordNet("worked", new AbortController().signal)).toMatchObject({ lemma: "work" });
  expect(queries).toEqual(["worked", "worke", "work"]);
});

it("prefers hope for hoping without confusing it with hopping", async () => {
  const queries = mockWordNet({ hope: [synset("v", "to wish")], hop: [synset("v", "to jump")] });
  expect(await lookupWordNet("hoping", new AbortController().signal)).toMatchObject({ lemma: "hope" });
  expect(queries).toEqual(["hoping", "hope"]);
});

it("does not treat a service failure as a missing entry", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(lookupWordNet("worked", new AbortController().signal)).rejects.toThrow("WordNet HTTP 503");
  expect(fetch).toHaveBeenCalledTimes(1);
});
