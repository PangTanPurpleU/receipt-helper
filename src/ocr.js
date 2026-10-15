import {parseReceipt,orderedLines,needsRecognitionRetry} from './core.js';
import {retryRegion,mergeRecognition} from './recognition-retry.js';
let worker,engine,current,initialization,id=0,pending=new Map();
export const MODEL_NAMES={'paddle-v6-tiny':'PaddleOCR v6 tiny 中文'};
export async function initialize(model='paddle-v6-tiny',progress=()=>{}){
 if(current===model&&engine)return;
 progress('正在启动本地识别引擎…');
 // Photo selection can warm the engine before import starts. Share that
 // initialization, including failures, instead of starting a second worker.
 if(initialization){await initialization;if(current===model&&engine)return;}
 const operation=(async()=>{
  await dispose();
  if(model.startsWith('paddle')){
   worker=new Worker(new URL('paddle-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data);}};
   worker.onerror=e=>{const error=new Error(e.message||'识别线程异常，请重新识别');for(const p of pending.values())p.reject(error);pending.clear();void dispose();};
   await send({type:'init',model});engine='paddle';
  }
  current=model;
 })();
 initialization=operation;
 try{await operation;}finally{if(initialization===operation)initialization=null;}
}
function send(data){const requestId=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('模型加载或识别超时，请重新识别'));void dispose();},180000);pending.set(requestId,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});try{worker.postMessage({...data,id:requestId},data.pixels?[data.pixels]:[]);}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);void dispose();}});}
export async function dispose(){current=null;if(worker){worker.terminate();worker=null;}if(engine&&engine!=='paddle')await engine.terminate();engine=null;for(const p of pending.values())p.reject(new Error('识别已停止'));pending.clear();}
export async function canvasFor(file,max=3000){
 let source;try{source=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{const u=URL.createObjectURL(file);try{source=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('图片格式暂不支持，请转为 JPG 或 PNG 后导入'));i.src=u;});}finally{URL.revokeObjectURL(u);}}
 const ratio=Math.min(1,max/Math.max(source.width,source.height)),c=document.createElement('canvas');c.width=Math.round(source.width*ratio);c.height=Math.round(source.height*ratio);c.getContext('2d').drawImage(source,0,0,c.width,c.height);source.close?.();return c;
}
async function predict(canvas){
 if(engine==='paddle'){
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
  return (await send({type:'predict',pixels:pixels.data.buffer,width:canvas.width,height:canvas.height})).result;
 }
 throw new Error('识别模型未初始化');
}
export async function recognize(file,model='paddle-v6-tiny',progress=()=>{},retry=true){
 // Decode while the worker loads. Await both even on failure, so the next
 // file cannot terminate an initialization that is still in progress.
 const [ready,image]=await Promise.allSettled([initialize(model,progress),canvasFor(file)]);
 if(ready.status==='rejected')throw ready.reason;
 if(image.status==='rejected')throw image.reason;
 progress('正在本地识别凭证…');const start=performance.now(),canvas=image.value;let r=await predict(canvas);
 const lines=r.items?.length?orderedLines(r.items):String(r.text||'').split('\n');let hasText=lines.some(s=>s.trim()),receipt=parseReceipt(lines);receipt.raw=lines.join('\n');
 let region=retry?retryRegion(r.items||[],receipt.fields,canvas.width,canvas.height):null;
 for(let pass=0;region&&pass<2;pass++){
  const crop=document.createElement('canvas');crop.width=region.width;crop.height=region.height;crop.getContext('2d').drawImage(canvas,region.x,region.y,region.width,region.height,0,0,crop.width,crop.height);
  const extra=await predict(crop),extraLines=extra.items?.length?orderedLines(extra.items):String(extra.text||'').split('\n');const second=parseReceipt([receipt.fields.Type,...extraLines],null,receipt.fields.Type);
  hasText ||= extraLines.some(s=>s.trim());receipt=mergeRecognition(receipt,second);receipt.raw+='\n\n分区补识别\n'+extraLines.join('\n');
  region=region.targeted&&needsRecognitionRetry(receipt)?retryRegion([],receipt.fields,canvas.width,canvas.height):null;
 }

 if(!hasText)throw new Error('未识别到文字，请使用清晰、完整的凭证图片');
 receipt.elapsedMs=performance.now()-start;return receipt;
}
