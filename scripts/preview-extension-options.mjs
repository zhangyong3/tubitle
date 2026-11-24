// Isolated HTTP preview of the real settings UI. No access to extension storage.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = '/private/tmp/tubitle-options-preview';
await mkdir(output,{recursive:true});
await cp(resolve(root,'extension/dist'),output,{recursive:true});
await build({stdin:{contents:`
import { DEFAULT_SETTINGS } from './extension/src/shared/settings';
import { translateLocally, requestAnalysis } from './extension/src/local-providers';
let stored = JSON.parse(localStorage.getItem('tubitle-preview-settings') || 'null') || {...DEFAULT_SETTINGS, uiLanguage:'zh-CN', serviceMode:'custom', provider:'edge-free'};
const listeners = [];
globalThis.chrome = {
 storage:{local:{get:async()=>({settings:stored}),set:async value=>{const oldValue=stored; stored={...stored,...value.settings};localStorage.setItem('tubitle-preview-settings',JSON.stringify(stored));for(const listener of listeners)listener({settings:{oldValue,newValue:stored}},'local');}},onChanged:{addListener:fn=>listeners.push(fn)}},
 permissions:{request:async()=>true},
 runtime:{getURL:path=>path,sendMessage:async message=>{
 try {if(message.type==='TEST_PROVIDER') {
 if(message.provider==='llm'){const response=await requestAnalysis('This is a connection test.',stored);await response.body?.cancel();}
 else await translateLocally(message.provider,'Learning a language opens a new world.',stored,'en');
 }return {ok:true,data:null};}catch(error){return {ok:false,error:error.message};}
 }}
};
`,resolveDir:root,loader:'ts'},bundle:true,format:'iife',target:'chrome138',outfile:resolve(output,'preview.js'),define:{__TUBITLE_TRANSLATION_URL__:JSON.stringify('http://127.0.0.1:18081')}});
const html = await readFile(resolve(output,'options.html'),'utf8');
await writeFile(resolve(output,'options.html'),html.replace('<script src="options.js">','<script src="preview.js"></script><script src="options.js">'));
console.log(output);
await build({stdin:{contents:`
import { requestChromeTranslation } from './extension/src/shared/chrome-translator';
document.querySelector('button').addEventListener('click', async()=>{
 const out=document.querySelector('output');out.textContent='Translating…';
 try{out.textContent=await requestChromeTranslation('Learning a language opens a new world.','en','zh-Hant',new AbortController().signal);}
 catch(error){out.textContent=error.message;}
});
`,resolveDir:root,loader:'ts'},bundle:true,format:'iife',outfile:resolve(output,'bridge-test.js')});
await writeFile(resolve(output,'bridge-test.html'),`<!doctype html><meta charset="utf-8"><title>Chrome translation bridge test</title><style>body{font:20px system-ui;padding:50px;background:#1e1e1e;color:white}button{font:inherit;padding:12px}output{display:block;margin-top:24px}</style><h1>Chrome translation bridge test</h1><p>Public sample: Learning a language opens a new world.</p><button>Test page translation bridge</button><output></output><script src="page-bridge.js"></script><script src="bridge-test.js"></script>`);
