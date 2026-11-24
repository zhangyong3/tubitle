import { keylessRequest, keylessResult } from '../extension/src/keyless-providers.ts';
const engines = ['edge-free', 'google-free', 'volcengine-free', 'tencent-free', 'baidu-free', 'deepl-free'] as const;
for (const provider of engines) {
  const started = Date.now();
  try {
    const request = keylessRequest(provider, 'Learning a language opens a new world.', 'en', 'zh');
    const response = await fetch(request.url, {...request.init, redirect:'manual', signal:AbortSignal.timeout(15000)});
    let translation = '', reason = '';
    if (!response.ok) reason = response.headers.get('location') || response.statusText;
    if (response.ok) {
      const data = await response.json();
      try { translation = keylessResult(provider, data); } catch (error) { reason = (error as Error).message + ' ' + JSON.stringify(data).slice(0,250); }
    }
    console.log(JSON.stringify({provider,status:response.status,ms:Date.now()-started,translation:translation.slice(0,120),reason}));
  } catch (error) { console.log(JSON.stringify({provider,ms:Date.now()-started,error:(error as Error).message,cause:(error as Error & {cause?:Error}).cause?.message})); }
}
