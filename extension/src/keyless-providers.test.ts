import { afterEach, expect, it, vi } from 'vitest';
import { keylessRequest, keylessResult, translateKeyless } from './keyless-providers';
const cases = [
  ['edge-free', { protocol: 'https:', host: 'edge.microsoft.com' }, [{translations:[{text:'學習語言。'}]}]],
  ['google-free', { protocol: 'https:', host: 'translate.googleapis.com' }, {sentences:[{trans:'學習'}, {trans:'語言。'}]}],
  ['volcengine-free', { protocol: 'https:', host: 'translate.volcengine.com' }, {translation:'學習語言。'}],
  ['tencent-free', { protocol: 'https:', host: 'transmart.qq.com' }, {auto_translation:['學習語言。']}],
] as const;
afterEach(() => vi.unstubAllGlobals());
for (const [provider, endpoint, fixture] of cases) {
  it(`builds a keyless ${provider} request and parses its protocol`, () => {
    const request = keylessRequest(provider, 'Learn a language.', 'en', provider === 'tencent-free' ? 'zh' : 'zh-TW');
    expect(new URL(request.url)).toMatchObject(endpoint);
    expect(request.init.credentials).toBe('omit');
    expect(request.init.redirect).toBe('error');
    expect(new Headers(request.init.headers).has('Authorization')).toBe(false);
    expect(keylessResult(provider, fixture)).toBe('學習語言。');
    expect(() => keylessResult(provider, {error:'denied'})).toThrow('有效译文');
  });
}
it('preserves provider-specific Traditional Chinese language codes', () => {
  expect(new URL(keylessRequest('edge-free','Hello','en','zh-TW').url).searchParams.get('to')).toBe('zh-Hant');
  expect(new URL(keylessRequest('google-free','Hello','en','zh-TW').url).searchParams.get('tl')).toBe('zh-TW');
  expect(JSON.parse(keylessRequest('volcengine-free','Hello','en','zh-TW').init.body as string).target_language).toBe('zh-Hant');
  expect(() => keylessRequest('tencent-free','Hello','en','zh-TW')).toThrow('不支持繁体');
});
it('rejects rate limiting without converting the error to a cached translation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('',{status:429})));
  await expect(translateKeyless('edge-free','Hello','en','zh')).rejects.toThrow('429');
});
it('does not send an aborted queued request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
  const controller = new AbortController(); controller.abort();
  await expect(translateKeyless('edge-free','Hello','en','zh',controller.signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
