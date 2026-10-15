import JSZip from 'jszip';
import {parseReceipt} from './core.js';
// Keep legacy stores inert so an application update never purges previously stored data.
let db;
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export async function openDB(){if(db)return db;db=await new Promise((resolve,reject)=>{const r=indexedDB.open('receipt-helper-local',2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('receipts'))d.createObjectStore('receipts',{keyPath:'id'});if(!d.objectStoreNames.contains('photos'))d.createObjectStore('photos');if(!d.objectStoreNames.contains('trash'))d.createObjectStore('trash',{keyPath:'id'});if(!d.objectStoreNames.contains('recovery'))d.createObjectStore('recovery');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('请关闭其他打开此网站的标签页后重试'));});return db;}
const done=t=>new Promise((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('保存已取消'));});
export async function records(){const d=await openDB();return request(d.transaction('receipts').objectStore('receipts').getAll());}
export async function photo(id){const d=await openDB();return request(d.transaction('photos').objectStore('photos').get(id));}
export async function save(row,blob){const d=await openDB(),t=d.transaction(blob?['receipts','photos']:['receipts'],'readwrite'),complete=done(t);try{t.objectStore('receipts').put(row);if(blob)t.objectStore('photos').put(blob,row.id);}catch(error){t.abort();await complete.catch(()=>{});throw error;}await complete;}
export async function remove(ids){const d=await openDB(),wanted=new Set(ids),t=d.transaction(['receipts'],'readwrite'),complete=done(t);let count=0;const lookup=t.objectStore('receipts').getAll();lookup.onsuccess=()=>{for(const r of lookup.result)if(wanted.has(r.id)){t.objectStore('receipts').delete(r.id);count++;}};await complete;return count;}
export async function hash(blob){const a=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');}
export async function backup(){const rows=await records(),z=new JSZip();z.file('receipts.json',JSON.stringify(rows.map(({elapsedMs,model,...r})=>r),null,2));for(const r of rows){const b=await photo(r.id);if(!b)throw new Error('存档照片缺失，备份未生成：'+r.name);z.file(r.photo,b);}return z.generateAsync({type:'blob',compression:'STORE'});}
export async function restoreZIP(file){
 const limit=500*1024*1024;if(file.size>limit)throw new Error('备份超过 500 MB');
 // Inspect central-directory sizes BEFORE CRC verification inflates every entry.
 let z=await JSZip.loadAsync(file);
 const entries=Object.values(z.files).filter(e=>!e.dir);let size=0;
 if(entries.length>5001)throw new Error('备份文件数量过多');
 for(const entry of entries){const bytes=entry._data?.uncompressedSize;if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('备份文件大小无效');size+=bytes;if(size>limit)throw new Error('备份解压后过大');if(bytes>(entry.name==='receipts.json'?8:100)*1024*1024)throw new Error(entry.name==='receipts.json'?'备份记录文件过大':'备份照片过大');}
 if(!z.file('receipts.json'))throw new Error('备份缺少 receipts.json');
 z=await JSZip.loadAsync(file,{checkCRC32:true});
 const rows=JSON.parse(await z.file('receipts.json').async('string'));
 if(!Array.isArray(rows)||rows.length>5000)throw new Error('备份记录格式无效');
 const ids=new Set(),paths=new Set(),blobs=[],prepared=[];let expanded=0;
 for(const r of rows){
  if(!r||typeof r!=='object'||!/^[0-9a-f-]{36}$/i.test(r.id)||ids.has(r.id)||!/^photos\/[0-9a-f-]{36}\.(jpg|jpeg|png|bmp|heic)$/i.test(r.photo)||paths.has(r.photo)||!r.fields||typeof r.fields!=='object'||Array.isArray(r.fields)||Object.keys(r.fields).length>128||Object.values(r.fields).some(v=>typeof v!=='string'||v.length>32760)||! /^[a-f0-9]{64}$/i.test(r.hash)||typeof r.name!=='string'||r.name.length>1024||typeof r.raw!=='string'||typeof r.warning!=='string'||(r.imported!==undefined&&typeof r.imported!=='string'))throw new Error('备份中有无效或重复记录');
  ids.add(r.id);paths.add(r.photo);const entry=z.file(r.photo);
  if(!entry)throw new Error('备份中缺少照片：'+r.name);
  if(entry.unsafeOriginalName&&entry.unsafeOriginalName!==r.photo)throw new Error('备份照片路径无效');
  const b=await entry.async('blob');expanded+=b.size;if(expanded>limit)throw new Error('备份解压后过大');
  if(await hash(b)!==r.hash.toLowerCase())throw new Error('照片校验失败：'+r.name);blobs.push(b);
  const validated=parseReceipt([],r.fields);if(validated.fields.Type?.includes('转账')){validated.fields.Payee='';validated.fields.PayeeStatus='hidden';}prepared.push({...r,...validated});
 }
 const allowed=new Set(['receipts.json',...paths]);if(Object.values(z.files).some(e=>!e.dir&&!allowed.has(e.name)))throw new Error('备份中有未支持的文件');
 const d=await openDB(),t=d.transaction(['receipts','photos'],'readwrite'),complete=done(t);
 // Validate everything first; even a synchronous put failure must roll back clear().
 try{for(const name of ['receipts','photos'])t.objectStore(name).clear();prepared.forEach((r,i)=>{t.objectStore('receipts').put(r);t.objectStore('photos').put(blobs[i],r.id);});}catch(error){t.abort();await complete.catch(()=>{});throw error;}
 await complete;return rows.length;
}
