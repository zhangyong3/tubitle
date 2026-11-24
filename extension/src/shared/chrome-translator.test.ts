import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('uses the browser Translator API with Traditional Chinese and reuses the translator', async () => {
  vi.resetModules();
  const translate = vi.fn(async () => '學習語言。');
  const create = vi.fn(async () => ({translate}));
  vi.stubGlobal('Translator',{availability:async ()=>'available',create});
  const { translateInChrome } = await import('./chrome-translator');
  expect(await translateInChrome('Learn a language.','en','zh-TW')).toBe('學習語言。');
  await translateInChrome('Learn.','en','zh-TW');
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({sourceLanguage:'en',targetLanguage:'zh-Hant'}));
});
it('rejects an unavailable browser or language pair without cloud fallback', async () => {
  vi.resetModules(); vi.stubGlobal('Translator',undefined);
  const { translateInChrome } = await import('./chrome-translator');
  await expect(translateInChrome('Hi','en','zh')).rejects.toThrow('不可用');
  vi.stubGlobal('Translator',{availability:async ()=>'unavailable'});
  await expect(translateInChrome('Hi','en','zh')).rejects.toThrow('语言对');
});
it('requires a user gesture for language pack download and can retry after failure', async () => {
  vi.resetModules();
  const create = vi.fn(async () => ({translate:async ()=>'你好'}));
  vi.stubGlobal('Translator',{availability:async ()=>'downloadable',create});
  vi.stubGlobal('navigator',{userActivation:{isActive:false}});
  const { translateInChrome } = await import('./chrome-translator');
  await expect(translateInChrome('Hi','en','zh')).rejects.toThrow('点击播放');
  expect(create).not.toHaveBeenCalled();
  vi.stubGlobal('navigator',{userActivation:{isActive:true}});
  expect(await translateInChrome('Hi','en','zh')).toBe('你好');
});
