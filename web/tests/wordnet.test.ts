import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { lookupWordNet } from '../src/lib/wordnet';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const signal = () => new AbortController().signal;

test('returns definitions, parts of speech and examples for an existing saved word', async () => {
  globalThis.fetch = async () => Response.json([
    { partOfSpeech: 'n', definition: ['an imitation of a process'], example: ['a computer simulation'] },
  ]);
  assert.deepEqual(await lookupWordNet('Simulation', signal()), {
    lemma: 'simulation', senses: [{ partOfSpeech: 'noun', definitions: ['an imitation of a process'], examples: ['a computer simulation'] }],
  });
});

test('falls back to the base form for an inflected saved word', async () => {
  globalThis.fetch = async (url) => Response.json(String(url).endsWith('/clock')
    ? [{ partOfSpeech: 'v', definition: ['measure the time of'], example: [] }] : []);
  const result = await lookupWordNet('clocked', signal());
  assert.equal(result.lemma, 'clock');
  assert.equal(result.senses[0].partOfSpeech, 'verb');
});

test('empty entries remain distinct from service errors', async () => {
  globalThis.fetch = async () => Response.json([]);
  assert.deepEqual((await lookupWordNet('unknownword', signal())).senses, []);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(lookupWordNet('simulation', signal()), /503/);
});
