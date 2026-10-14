// Delegate gestures to the list so entering selection can redraw its cards.
// Scrolling, pointer cancellation and an extra finger must never select a card.
export function bindReceiptGestures(list,{isBusy,isSelecting,enter,toggle,open,delay=500,schedule=setTimeout,cancelTimer=clearTimeout}){
 const doc=list.ownerDocument;let press=null,suppressClick=false;
 const card=target=>target?.closest?.('[data-id]');
 function cancel(){if(press?.timer!==null&&press?.timer!==undefined)cancelTimer(press.timer);press=null;}
 function down(e){
  if(press&&press.pointer!==e.pointerId)cancel();
  const item=card(e.target);if(!item||!list.contains(item))return;
  suppressClick=false;cancel();
  if(isBusy()||e.button!==0||e.isPrimary===false)return;
  const state={pointer:e.pointerId,id:item.dataset.id,x:e.clientX,y:e.clientY,timer:null};press=state;
  state.timer=schedule(()=>{if(press!==state||isBusy())return;state.timer=null;suppressClick=true;enter(state.id);},delay);
 }
 function move(e){if(press&&e.pointerId===press.pointer&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)cancel();}
 function up(e){if(press&&e.pointerId===press.pointer)cancel();}
 function click(e){
  const item=card(e.target);if(!item||!list.contains(item))return;
  if(suppressClick){suppressClick=false;e.preventDefault();e.stopPropagation();return;}
  if(isBusy())return;e.preventDefault();
  isSelecting()?toggle(item.dataset.id):open(item.dataset.id);
 }
 function key(e){if(e.key==='Enter'||e.code==='Space')suppressClick=false;const item=card(e.target);if(item&&list.contains(item)&&e.shiftKey&&e.code==='Space'&&!isBusy()){e.preventDefault();if(e.repeat)return;cancel();suppressClick=false;isSelecting()?toggle(item.dataset.id):enter(item.dataset.id);}}
 function context(e){if(card(e.target)&&list.contains(card(e.target)))e.preventDefault();}
 doc.addEventListener('pointerdown',down);doc.addEventListener('pointermove',move,{passive:true});doc.addEventListener('pointerup',up);doc.addEventListener('pointercancel',up);doc.addEventListener('scroll',cancel,{capture:true,passive:true});
 list.addEventListener('click',click);list.addEventListener('keydown',key);list.addEventListener('contextmenu',context);
 return ()=>{cancel();doc.removeEventListener('pointerdown',down);doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerup',up);doc.removeEventListener('pointercancel',up);doc.removeEventListener('scroll',cancel,true);list.removeEventListener('click',click);list.removeEventListener('keydown',key);list.removeEventListener('contextmenu',context);};
}
