import test from 'node:test';
import assert from 'node:assert/strict';

// Model IndexedDB's atomic commit: requests run in the transaction before commit.
function fixture(failRecordDelete=false){
 const stores={receipts:new Map([['a',{id:'a'}],['b',{id:'b'}]]),photos:new Map([['a','photo-a'],['b','photo-b'],['orphan','orphan-photo']]),trash:new Map([['old',{id:'old'}]]),recovery:new Map([['before-restore','old-backup']])};
 const scopes=[];
 const db={transaction(names,mode){scopes.push(names);const staged=Object.fromEntries(Object.entries(stores).map(([k,v])=>[k,new Map(v)]));const tx={objectStore(name){assert.ok(names.includes(name));return {getAll(){const r={};queueMicrotask(()=>{try{r.result=[...staged[name].values()];r.onsuccess?.();if(mode==='readwrite')for(const key of names)stores[key]=staged[key];tx.oncomplete?.();}catch(error){tx.error=error;tx.onabort?.();}});return r;},delete(id){if(name==='receipts'&&failRecordDelete)throw new Error('record delete failed');staged[name].delete(id);}};}};return tx;}};
 globalThis.indexedDB={open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess();});return r;}};
 return {stores,scopes};
}
test('confirmed deletion removes only selected records, preserving every photo and legacy data',async()=>{
 const {stores,scopes}=fixture();const {remove}=await import('../src/storage.js?delete-success');
 assert.equal(await remove(['a','a','missing','orphan']),1);
 assert.deepEqual([...stores.receipts.keys()],['b']);assert.deepEqual([...stores.photos.keys()],['a','b','orphan']);
 assert.equal(stores.trash.size,1);assert.equal(stores.recovery.size,1);assert.deepEqual(scopes,[['receipts']]);
 assert.equal(await remove(['a']),0);
});
test('failure deleting a record preserves records and every photo',async()=>{
 const {stores}=fixture(true);const {remove}=await import('../src/storage.js?delete-failure');
 await assert.rejects(remove(['a']),/record delete failed/);
 assert.equal(stores.receipts.size,2);assert.equal(stores.photos.get('a'),'photo-a');
});
