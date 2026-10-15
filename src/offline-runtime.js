// A registration may exist even when installation failed. Bound every phase,
// including serviceWorker.ready, so download/import never wait indefinitely.
export async function waitForOfflineRuntime(registrationPromise,{serviceWorker,version,timeoutMs=15000,probeMs=500,pollMs=250,createChannel=()=>new MessageChannel()}={}){
 const deadline=Date.now()+timeoutMs,message='本地缓存组件未能就绪，请刷新网页后重试';
 async function bounded(promise){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),Math.max(0,deadline-Date.now()));})]);}finally{clearTimeout(timer);}
 }
 const registration=await bounded(registrationPromise);
 if(!registration||!serviceWorker)throw new Error('此浏览器无法启用本地模型缓存，请用 Safari 打开正式网址');
 await bounded(serviceWorker.ready);
 while(Date.now()<deadline){
  const worker=serviceWorker.controller;
  if(worker){
   const usable=await new Promise(resolve=>{
    const channel=createChannel();let timer;
    const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
    timer=setTimeout(()=>finish(false),Math.min(probeMs,Math.max(0,deadline-Date.now())));
    channel.port1.onmessage=e=>finish(e.data===version);
    try{worker.postMessage('model-cache-version',[channel.port2]);}catch{finish(false);}
   });
   if(usable)return;
  }
  await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(0,deadline-Date.now()))));
 }
 throw new Error(message);
}
