import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './shared/settings';
const account = vi.hoisted(() => vi.fn(async () => Response.json({ choices: [{message: {content: 'platform'}}] })));
vi.mock('./learning-sync', () => ({ requestAccountAnalysis: account }));
import { requestSentenceAnalysis } from './analysis-provider';
afterEach(() => { vi.unstubAllGlobals(); account.mockClear(); });
it('uses the account gateway by default without calling personal endpoints', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await requestSentenceAnalysis('Hello.', 'req', { ...DEFAULT_SETTINGS, llmApiKey: 'private' }, new AbortController().signal);
  expect(account).toHaveBeenCalledOnce();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('uses a personal API directly without an account or platform quota request', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response('data: [DONE]\n\n', { headers: {'content-type': 'text/event-stream'} }));
  vi.stubGlobal('fetch', fetchMock);
  await requestSentenceAnalysis('Hello.', 'req', { ...DEFAULT_SETTINGS, serviceMode: 'custom', llmBaseUrl: 'https://personal.example/v1', llmApiKey: 'my-key', llmModel: 'my-model' }, new AbortController().signal);
  expect(account).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith('https://personal.example/v1/chat/completions', expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer my-key' }) }));
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).model).toBe('my-model');
});
