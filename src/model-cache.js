import {MODEL_ASSETS,MODEL_PACKS} from './model-assets.js';

export const MODEL_CACHE='receipt-ocr-v5-v1';
const fingerprint=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

// Check actual Cache Storage entries, never a localStorage “downloaded” flag.
export function createModelStore({assets,baseURL,cacheStorage=globalThis.caches,fetcher=globalThis.fetch,digest=fingerprint}){
 const url=a=>new URL(a.path,baseURL).href;
 const total=assets.reduce((n,a)=>n+a.bytes,0);
 let operation;
 async function checked(cache,a,migrate=false){
  const key=url(a),r=await cache.match(key);
  if(r?.ok&&r.headers.get('x-receipt-sha256')===a.sha256&&Number(r.headers.get('content-length'))===a.bytes)return true;
  if(r)await cache.delete(key);
  if(migrate){
   // Adopt matching resources from the previous app cache without downloading again.
   const old=await cacheStorage.match(key);
   if(old?.ok){const bytes=await old.arrayBuffer();if(bytes.byteLength===a.bytes&&await digest(bytes)===a.sha256){await put(cache,a,bytes,old.headers.get('content-type'));return true;}}
  }
  return false;
 }
 async function put(cache,a,bytes,type){
  await cache.put(url(a),new Response(bytes,{headers:{'content-type':type||'application/octet-stream','content-length':String(bytes.byteLength),'x-receipt-sha256':a.sha256}}));
 }
 async function inspect({migrate=false}={}){
  if(!cacheStorage||!globalThis.isSecureContext&&typeof window!=='undefined')throw new Error('当前浏览器无法保存识别模型，请使用 Safari 打开正式 HTTPS 网址');
  const cache=await cacheStorage.open(MODEL_CACHE);let bytes=0,missing=[];
  for(const a of assets){if(await checked(cache,a,migrate))bytes+=a.bytes;else missing.push(a.path);}
  return {ready:missing.length===0,bytes,total,missing};
 }
 async function perform({signal,onProgress=()=>{}}={}){
  const cache=await cacheStorage.open(MODEL_CACHE);let completed=0;
  for(const a of assets){
   signal?.throwIfAborted();
   if(await checked(cache,a,true)){completed+=a.bytes;onProgress({bytes:completed,total,stage:'downloading'});continue;}
   const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
   signal?.addEventListener('abort',abort,{once:true});
   const timeout=setTimeout(()=>controller.abort(new Error('下载超时，请检查网络后继续下载')),180000);
   try{
    const r=await fetcher(url(a),{cache:'no-store',signal:controller.signal});
    if(!r.ok)throw new Error(`下载失败（${r.status}），请检查网络后重试`);
    const reader=r.body?.getReader();let bytes;
    if(reader){
     const chunks=[];let loaded=0;
     while(true){const chunk=await reader.read();if(chunk.done)break;loaded+=chunk.value.byteLength;if(loaded>a.bytes){await reader.cancel();throw new Error('模型文件大小不符，请重试');}chunks.push(chunk.value);onProgress({bytes:completed+loaded,total,stage:'downloading'});}
     bytes=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    }else bytes=new Uint8Array(await r.arrayBuffer());
    onProgress({bytes:completed+bytes.byteLength,total,stage:'verifying'});
    signal?.throwIfAborted();
    if(bytes.byteLength!==a.bytes||await digest(bytes)!==a.sha256)throw new Error('模型完整性校验失败，请重新下载');
    await put(cache,a,bytes,r.headers.get('content-type'));completed+=a.bytes;
    onProgress({bytes:completed,total,stage:'saved'});
   }catch(e){if(controller.signal.aborted&&!signal?.aborted)throw new Error('下载超时，请检查网络后继续下载');throw e;}
   finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  const state=await inspect();if(!state.ready)throw new Error('模型未能完整保存，可能是浏览器存储空间不足');return state;
 }
 function download(options){if(!operation)operation=perform(options).finally(()=>{operation=null;});return operation;}
 return {inspect,download,total};
}
export const modelStore=createModelStore({assets:MODEL_ASSETS,baseURL:new URL('./',import.meta.url)});
const stores=new Map([['paddle-v6-tiny',modelStore]]);
export function getModelStore(model){
 if(!MODEL_PACKS[model])throw new Error('不支持的本地识别模型');
 if(!stores.has(model))stores.set(model,createModelStore({assets:MODEL_PACKS[model],baseURL:new URL('./',import.meta.url)}));
 return stores.get(model);
}

// Remove only retired model weights. Reuse tiny weights and the shared runtime;
// receipt photos and records live in IndexedDB and are never touched here.
export async function pruneRetiredModels({cacheStorage=globalThis.caches,baseURL=new URL('./',import.meta.url)}={}){
 if(!cacheStorage)return;
 const cache=await cacheStorage.open(MODEL_CACHE);
 for(const prefix of ['PP-OCRv5_mobile','PP-OCRv6_small'])for(const suffix of ['_det.tar','_rec.tar'])await cache.delete(new URL('models/'+prefix+suffix,baseURL).href);
}
