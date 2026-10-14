import test from 'node:test';
import assert from 'node:assert/strict';
import {createBatchRecognizer} from '../src/batch-recognition.js';
test('only identical bytes reuse OCR, with independent original fields',async()=>{
 let calls=0;
 const run=createBatchRecognizer(async file=>{calls++;return {fields:{Amount:file.bytes},raw:file.bytes,warning:''};},async file=>file.bytes);
 const a=await run({name:'a.png',bytes:'128.50'});a.result.fields.Amount='edited';
 const b=await run({name:'different-name.png',bytes:'128.50'});
 const c=await run({name:'a.png',bytes:'66.00'});
 assert.equal(calls,2);assert.equal(b.reused,true);assert.equal(b.result.fields.Amount,'128.50');assert.equal(c.reused,false);
});
test('failed recognition is retried and caches never cross batches',async()=>{
 let calls=0;const recognize=async()=>{if(++calls===1)throw new Error('failed');return {fields:{Amount:'1.00'},raw:'original',warning:'review'};};
 const run=createBatchRecognizer(recognize,async()=> 'hash');
 await assert.rejects(run({}),/failed/);assert.equal((await run({})).reused,false);assert.equal((await run({})).reused,true);
 assert.equal((await createBatchRecognizer(recognize,async()=> 'hash')({})).reused,false);assert.equal(calls,3);
});
test('bounded cache evicts old results without dropping files',async()=>{
 let calls=0;const run=createBatchRecognizer(async()=>{calls++;return {fields:{},raw:'',warning:''};},async file=>file,2);
 for(const file of ['a','b','c','a'])await run(file);assert.equal(calls,4);
});
