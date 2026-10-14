import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createModelStore,MODEL_CACHE} from '../src/model-cache.js';
import {MODEL_PACKS,MODEL_ASSETS} from '../src/model-assets.js';
import {LOCAL_MODELS,localModel} from '../src/models.js';
const sha=b=>createHash('sha256').update(b instanceof ArrayBuffer?new Uint8Array(b):b).digest('hex');
class MemoryCaches{
 constructor(){this.stores=new Map();}
 async open(name){if(!this.stores.has(name)){const entries=new Map();this.stores.set(name,{entries,match:async k=>entries.get(String(k))?.clone(),put:async(k,r)=>{entries.set(String(k),r.clone());},delete:async k=>entries.delete(String(k))});}return this.stores.get(name);}
 async match(key){for(const c of this.stores.values()){const r=await c.match(key);if(r)return r;}}
}
function fixture(fetcher){const data=[new TextEncoder().encode('model-one'),new TextEncoder().encode('runtime-two')],assets=data.map((b,i)=>({path:`asset-${i}`,bytes:b.length,sha256:sha(b)})),cacheStorage=new MemoryCaches(),calls=[];
 const store=createModelStore({assets,baseURL:'https://test.invalid/subpath/',cacheStorage,digest:sha,fetcher:fetcher|| (async url=>{calls.push(url);return new Response(data[Number(url.at(-1))]);})});return {store,cacheStorage,assets,calls,data};}
test('missing is red; full validated downloads become ready and are reused without network',async()=>{const f=fixture();assert.equal((await f.store.inspect()).ready,false);await f.store.download();assert.equal((await f.store.inspect()).ready,true);assert.deepEqual(f.calls,['https://test.invalid/subpath/asset-0','https://test.invalid/subpath/asset-1']);await f.store.download();assert.equal(f.calls.length,2);});
test('HTTP failures and truncated/corrupt responses never become ready',async()=>{for(const response of [new Response('oops',{status:403}),new Response('bad'),new Response('model-xxx')]){const f=fixture(async()=>response.clone());await assert.rejects(f.store.download());assert.equal((await f.store.inspect()).ready,false);}});
test('cancelling preserves complete files; retry downloads only remaining resources',async()=>{const f=fixture(),controller=new AbortController();await assert.rejects(f.store.download({signal:controller.signal,onProgress:p=>{if(p.bytes===f.assets[0].bytes&&p.stage==='saved')controller.abort();}}));assert.equal((await f.store.inspect()).bytes,f.assets[0].bytes);await f.store.download();assert.equal(f.calls.length,2);assert.equal((await f.store.inspect()).ready,true);});
test('cache eviction and changed fingerprints are detected on the next check',async()=>{const f=fixture();await f.store.download();const cache=await f.cacheStorage.open(MODEL_CACHE);await cache.delete(f.calls[0]);assert.equal((await f.store.inspect()).ready,false);await f.store.download();f.assets[1].sha256='new-version';assert.equal((await f.store.inspect()).ready,false);});
test('old app cache migrates only matching bytes, then model cache survives shell removal',async()=>{const f=fixture(),old=await f.cacheStorage.open('receipt-pages-v1');await old.put('https://test.invalid/subpath/asset-0',new Response(f.data[0]));await old.put('https://test.invalid/subpath/asset-1',new Response('broken'));assert.equal((await f.store.inspect({migrate:true})).bytes,f.assets[0].bytes);f.cacheStorage.stores.delete('receipt-pages-v1');await f.store.download();assert.equal(f.calls.length,1);assert.equal((await f.store.inspect()).ready,true);});
test('storage write failure stays unavailable and concurrent downloads share one operation',async()=>{const f=fixture(),a=f.store.download(),b=f.store.download();assert.equal(a,b);await a;assert.equal(f.calls.length,2);const g=fixture(),cache=await g.cacheStorage.open(MODEL_CACHE);cache.put=async()=>{throw new DOMException('full','QuotaExceededError');};await assert.rejects(g.store.download(),{name:'QuotaExceededError'});assert.equal((await g.store.inspect()).ready,false);});

test('model packs include only their own models plus identical shared runtime',()=>{
 assert.deepEqual(MODEL_ASSETS,MODEL_PACKS['paddle-v5']);
 const shared=MODEL_ASSETS.filter(a=>!a.path.startsWith('models/'));
 for(const model of LOCAL_MODELS){
  const assets=MODEL_PACKS[model.id];assert.equal(assets.length,5);
  assert.deepEqual(assets.filter(a=>a.path.startsWith('models/')).map(a=>a.path),['_det.tar','_rec.tar'].map(suffix=>'models/'+model.prefix+suffix));
  assert.deepEqual(assets.filter(a=>!a.path.startsWith('models/')),shared);
  assert.ok(assets.every(a=>a.bytes>0&&/^[a-f0-9]{64}$/.test(a.sha256)));
 }
 assert.throws(()=>localModel('unknown'),/不支持/);
});
test('switching model preserves cached models and downloads shared runtime once',async()=>{
 const bodies={v5:new TextEncoder().encode('five'),v6:new TextEncoder().encode('six'),runtime:new TextEncoder().encode('shared')};
 const manifest=name=>({path:name,bytes:bodies[name].length,sha256:sha(bodies[name])});
 const cacheStorage=new MemoryCaches(),calls=[];
 const store=names=>createModelStore({assets:names.map(manifest),baseURL:'https://test.invalid/',cacheStorage,digest:sha,fetcher:async url=>{const name=new URL(url).pathname.slice(1);calls.push(name);return new Response(bodies[name]);}});
 const v5=store(['v5','runtime']),v6=store(['v6','runtime']);
 await v5.download();assert.equal((await v6.inspect()).ready,false);
 await v6.download();assert.deepEqual(calls,['v5','runtime','v6']);
 assert.equal((await v5.inspect()).ready,true);assert.equal((await v6.inspect()).ready,true);
});
