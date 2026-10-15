import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
test('packaged preview serves the built site and WASM, handles HEAD and rejects writes/traversal',async()=>{
 const child=spawn(process.execPath,['tools/serve.mjs','--port','0'],{stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview startup timed out')),5000);child.once('error',reject);child.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//);if(m){clearTimeout(timer);resolve(m[0]);}});});
  const page=await fetch(base);assert.equal(page.status,200);assert.equal(await page.text(),await readFile('dist/index.html','utf8'));
  const wasm=await fetch(base+'vendor/ort/ort-wasm-simd-threaded.wasm',{method:'HEAD'});assert.equal(wasm.status,200);assert.equal(wasm.headers.get('content-type'),'application/wasm');assert.ok(Number(wasm.headers.get('content-length'))>1000000);assert.equal(await wasm.text(),'');
  assert.equal((await fetch(base+'unknown.file')).status,404);assert.equal((await fetch(base,{method:'POST',body:'no'})).status,405);assert.equal((await fetch(base+'..%2fpackage.json')).status,403);assert.equal((await fetch(base+'%ZZ')).status,400);
 }finally{const exited=once(child,'exit');child.kill();await exited;}
});
