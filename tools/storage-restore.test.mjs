import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
const id='00000000-0000-4000-8000-000000000001',photoPath='photos/'+id+'.png',bytes=Buffer.from('synthetic photo fixture');
const row={id,photo:photoPath,name:'测试凭证.png',hash:createHash('sha256').update(bytes).digest('hex'),imported:'2026-10-15T00:00:00.000Z',raw:'合成测试',warning:'',fields:{Type:'微信支付截图',PaymentKind:'商户支付',Transaction:'4500000000202610151234567890',Amount:'12.00',Payee:'测试商户',Traded:'2026-10-15 12:00:00',TradeStatus:'支付成功'}};
async function archive(rows=[row],photo=bytes){const z=new JSZip();z.file('receipts.json',JSON.stringify(rows));z.file(photoPath,photo);return z.generateAsync({type:'uint8array',compression:'STORE'});}
function database({failPut=false}={}){
 const state={receipts:new Map([['original',{id:'original',name:'原凭证'}]]),photos:new Map([['original',new Blob(['original photo'])]])};let opened=0;
 const db={transaction(names){const staged=Object.fromEntries(names.map(n=>[n,new Map(state[n])])),tx={aborted:false,abort(){this.aborted=true;},objectStore(name){return {clear(){staged[name].clear();},put(value,key){if(failPut&&name==='receipts')throw new Error('simulated synchronous write failure');staged[name].set(key??value.id,value);}};}};setImmediate(()=>{if(tx.aborted){tx.onabort?.();return;}for(const n of names)state[n]=staged[n];tx.oncomplete?.();});return tx;}};
 globalThis.indexedDB={open(){opened++;const r={};queueMicrotask(()=>{r.result=db;r.onsuccess();});return r;}};
 return {state,get opened(){return opened;}};
}
test('restore rejects malformed timestamps and preserves original data before opening a transaction',async()=>{
 const d=database();const {restoreZIP}=await import('../src/storage.js?invalid-imported');await assert.rejects(restoreZIP(await archive([{...row,imported:42}])),/无效/);assert.equal(d.opened,0);assert.equal(d.state.receipts.size,1);
});
test('restore rejects oversized ZIP metadata before attempting decompression',async()=>{
 const d=database(),zip=Buffer.from(await archive());const central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);zip.writeUInt32LE(600*1024*1024,central+24);
 const {restoreZIP}=await import('../src/storage.js?oversized');await assert.rejects(restoreZIP(zip),/过大/);assert.equal(d.opened,0);
});
test('photo digest or archive CRC mismatch cannot replace existing records',async()=>{
 const d=database();const {restoreZIP}=await import('../src/storage.js?corrupt');await assert.rejects(restoreZIP(await archive([row],Buffer.from('changed photo'))),/照片校验失败/);
 const zip=Buffer.from(await archive()),central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));zip.writeUInt32LE(0,central+16);await assert.rejects(restoreZIP(zip),/CRC32/);assert.equal(d.opened,0);assert.equal(d.state.receipts.has('original'),true);
});
test('valid restore retains screenshot fields, while synchronous write failure rolls back both stores',async()=>{
 const ok=database();const success=await import('../src/storage.js?valid');assert.equal(await success.restoreZIP(await archive()),1);assert.equal(ok.state.receipts.get(id).fields.Payee,'测试商户');assert.equal(ok.state.photos.size,1);
 const bad=database({failPut:true});const failure=await import('../src/storage.js?abort');await assert.rejects(failure.restoreZIP(await archive()),/synchronous write failure/);await new Promise(resolve=>setImmediate(resolve));assert.equal(bad.state.receipts.has('original'),true);assert.equal(bad.state.photos.has('original'),true);
});
test('synchronous save errors reject cleanly and preserve existing receipt and photo',async()=>{
 const d=database({failPut:true});const {save}=await import('../src/storage.js?save-abort');await assert.rejects(save(row,new Blob([bytes])),/synchronous write failure/);await new Promise(resolve=>setImmediate(resolve));assert.equal(d.state.receipts.has('original'),true);assert.equal(d.state.photos.size,1);
});
