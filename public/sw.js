const SHELL=__SHELL_CACHE__,MODEL_CACHE='receipt-ocr-v5-v1',ASSETS=__OCR_ASSETS__;
const absolute=p=>new URL(p,self.registration.scope).href;
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(SHELL);await c.addAll(['','app.js','style.css','icon.png','manifest.webmanifest'].map(absolute));await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{await self.clients.claim();await Promise.all((await caches.keys()).filter(k=>k.startsWith('receipt-shell-')&&k!==SHELL).map(k=>caches.delete(k)));/* Legacy receipt-pages caches are kept until the page verifies and migrates their model resources. */})()));
self.addEventListener('message',e=>{if(e.data==='model-cache-version')e.ports[0]?.postMessage(MODEL_CACHE);});
self.addEventListener('fetch',e=>{
 const request=e.request;if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const asset=ASSETS.find(a=>absolute(a.path)===request.url);
 const shellPaths=['','index.html','app.js','style.css','icon.png','manifest.webmanifest'].map(absolute);
 if(!asset&&!shellPaths.includes(request.url))return;
 e.respondWith((async()=>{
  if(asset){const c=await caches.open(MODEL_CACHE),r=await c.match(request);if(r?.ok&&r.headers.get('x-receipt-sha256')===asset.sha256)return r;return fetch(request);}
  const c=await caches.open(SHELL);
  try{const r=await fetch(request);if(r.ok)await c.put(request,r.clone());return r;}catch(error){const saved=await c.match(request)|| (request.mode==='navigate'?await c.match(absolute('')):null);if(saved)return saved;throw error;}
 })());
});
