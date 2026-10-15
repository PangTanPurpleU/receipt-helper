import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForOfflineRuntime} from '../src/offline-runtime.js';
import {requestPersistence,localDay,storageError} from '../src/ui-utils.js';
import {initialize,dispose} from '../src/ocr.js';

test('offline runtime bounds a stalled registration and a registered worker that never activates',async()=>{
 const never=new Promise(()=>{}),options={version:'current',timeoutMs:20};
 await assert.rejects(waitForOfflineRuntime(never,options),/未能就绪/);
 await assert.rejects(waitForOfflineRuntime(Promise.resolve({}),{...options,serviceWorker:{ready:never}}),/未能就绪/);
 await assert.rejects(waitForOfflineRuntime(Promise.resolve(null),options),/无法启用/);
});
test('offline runtime waits for the current controller and closes message ports',async()=>{
 let calls=0,closed=0;
 const createChannel=()=>{const channel={port1:{close(){closed++;}},port2:{close(){closed++;}}};channel.port2.answer=value=>queueMicrotask(()=>channel.port1.onmessage({data:value}));return channel;};
 const serviceWorker={ready:Promise.resolve({}),controller:{postMessage(message,[port]){assert.equal(message,'model-cache-version');port.answer(++calls===1?'old':'current');}}};
 await waitForOfflineRuntime(Promise.resolve({}),{serviceWorker,version:'current',createChannel,timeoutMs:200,pollMs:1});assert.equal(calls,2);assert.equal(closed,4);
 await assert.rejects(waitForOfflineRuntime(Promise.resolve({}),{serviceWorker:{ready:Promise.resolve({}),controller:{postMessage(){throw new Error('worker gone');}}},version:'current',createChannel,timeoutMs:20,pollMs:1}),/未能就绪/);
});
test('denied or unsupported persistence does not fail an import; storage failure has actionable text',async()=>{
 assert.equal(await requestPersistence({persist:async()=>{throw new Error('permission denied');}}),false);assert.equal(await requestPersistence({}),false);assert.equal(await requestPersistence({persist:async()=>true}),true);
 assert.match(storageError({name:'QuotaExceededError'}),/存储空间不足/);assert.equal(storageError(new Error('bad file')),'bad file');
 // The helper must read local calendar fields, never UTC's preceding day.
 assert.equal(localDay({getFullYear:()=>2026,getMonth:()=>9,getDate:()=>16,toISOString:()=>{throw new Error('UTC date used');}}),'2026-10-16');
});
test('a fatal OCR worker error discards the dead engine and initializes a fresh worker',async()=>{
 const previous=globalThis.Worker,workers=[],flush=()=>new Promise(resolve=>setImmediate(resolve));
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.request=data;}terminate(){this.terminated=true;}ready(){this.onmessage({data:{id:this.request.id}});}};
 try{const first=initialize();await flush();workers[0].ready();await first;workers[0].onerror({message:'worker crashed'});assert.equal(workers[0].terminated,true);const next=initialize();await flush();assert.equal(workers.length,2);workers[1].ready();await next;}finally{await dispose();globalThis.Worker=previous;}
});
test('timed out OCR initialization resets the engine instead of poisoning later imports',async()=>{
 const previousWorker=globalThis.Worker,previousTimeout=globalThis.setTimeout,workers=[],timers=[],flush=()=>new Promise(resolve=>setImmediate(resolve));
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.request=data;}terminate(){this.terminated=true;}ready(){this.onmessage({data:{id:this.request.id}});}};
 globalThis.setTimeout=(fn,ms,...args)=>ms===180000?(timers.push(fn),0):previousTimeout(fn,ms,...args);
 try{const first=initialize(),failure=assert.rejects(first,/超时/);await flush();timers[0]();await failure;assert.equal(workers[0].terminated,true);const retry=initialize();await flush();workers[1].ready();await retry;assert.equal(workers.length,2);}finally{await dispose();globalThis.Worker=previousWorker;globalThis.setTimeout=previousTimeout;}
});
