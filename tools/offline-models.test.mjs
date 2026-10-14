import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MODEL_PACKS,MODEL_VERSION} from '../src/model-assets.js';
import {MODEL_CACHE} from '../src/model-cache.js';
test('service worker confirms current manifest and serves each model from verified cache',async()=>{
 const assets=[...new Map(Object.values(MODEL_PACKS).flat().map(a=>[a.path,a])).values()];
 const handlers=new Map(),entries=new Map(),scope='https://test.invalid/receipt-helper/';
 const caches={open:async()=>({match:async req=>entries.get(typeof req==='string'?req:req.url)})};
 let networkCalls=0;
 const self={registration:{scope},location:{origin:'https://test.invalid'},addEventListener:(name,fn)=>handlers.set(name,fn)};
 const source=(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'))
  .replace('__SHELL_CACHE__','"test-shell"').replace('__OCR_ASSETS__',JSON.stringify(assets)).replace('__OCR_VERSION__',JSON.stringify(MODEL_VERSION));
 vm.runInNewContext(source,{self,caches,URL,fetch:async()=>{networkCalls++;throw new Error('offline');}});
 let version;handlers.get('message')({data:'model-cache-version',ports:[{postMessage:v=>{version=v;}}]});
 assert.equal(version,MODEL_CACHE+':'+MODEL_VERSION);assert.notEqual(version,MODEL_CACHE);
 for(const asset of assets){
  const url=new URL(asset.path,scope).href;
  entries.set(url,new Response('cached',{headers:{'x-receipt-sha256':asset.sha256}}));
  let response;handlers.get('fetch')({request:{method:'GET',url},respondWith:p=>{response=p;}});
  assert.equal(await (await response).text(),'cached');
 }
 assert.equal(networkCalls,0);
});
