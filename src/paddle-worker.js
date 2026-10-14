import {PaddleOCR} from '@paddleocr/paddleocr-js';
import {localModel} from './models.js';
// Canvas-only adapter for the SDK browser entry in a dedicated worker.
globalThis.HTMLCanvasElement=OffscreenCanvas;
globalThis.HTMLImageElement=class {};
globalThis.document={createElement(tag){if(tag!=='canvas')throw new Error('Unsupported worker element: '+tag);return new OffscreenCanvas(1,1);}};
let engine,kind;
self.onmessage=async({data})=>{
 try {
  if(data.type==='init'){
   if(engine)engine.dispose();kind=data.model;
   const prefix=localModel(kind).prefix;
   engine=await PaddleOCR.create({textDetectionModelName:prefix+'_det',textRecognitionModelName:prefix+'_rec',textDetectionModelAsset:{url:new URL('models/'+prefix+'_det.tar',self.location).href},textRecognitionModelAsset:{url:new URL('models/'+prefix+'_rec.tar',self.location).href},ortOptions:{backend:'wasm',wasmPaths:new URL('vendor/ort/',self.location).href,numThreads:1,simd:true}});
   self.postMessage({id:data.id,ready:true});return;
  }
  const image=new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height);
  const [r]=await engine.predict(image,{textDetLimitSideLen:1600,textDetLimitType:'max',textRecScoreThresh:0.3});
  self.postMessage({id:data.id,result:{items:r.items,metrics:r.metrics}});
 }catch(e){self.postMessage({id:data.id,error:e.message||String(e)});}
};
