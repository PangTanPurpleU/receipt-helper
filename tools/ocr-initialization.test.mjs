import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,dispose} from '../src/ocr.js';
test('photo picker warmup and recognition share one worker; errors can retry',async()=>{
 const previous=globalThis.Worker,workers=[];
 globalThis.Worker=class{
  constructor(){workers.push(this);}
  postMessage(data){this.request=data;}
  terminate(){this.terminated=true;}
  ready(error){this.onmessage({data:{id:this.request.id,error}});}
 };
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  const warm=initialize(),recognition=initialize();await flush();
  assert.equal(workers.length,1);workers[0].ready();await Promise.all([warm,recognition]);
  await initialize();assert.equal(workers.length,1);
  await dispose();assert.equal(workers[0].terminated,true);
  const failed=initialize();await flush();workers[1].ready('load failed');await assert.rejects(failed,/load failed/);
  const retry=initialize();await flush();workers[2].ready();await retry;assert.equal(workers.length,3);
 }finally{await dispose();globalThis.Worker=previous;}
});
