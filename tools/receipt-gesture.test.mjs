import test from 'node:test';
import assert from 'node:assert/strict';
import {bindReceiptGestures} from '../src/receipt-gesture.js';
function fixture(){
 const doc=new EventTarget(),list=new EventTarget(),cards=['a','b'].map(id=>({dataset:{id},closest(){return this;}}));list.ownerDocument=doc;list.contains=e=>cards.includes(e);
 const timers=new Map(),selected=new Set(),opened=[];let sequence=0;
 const stop=bindReceiptGestures(list,{isBusy:()=>false,isSelecting:()=>selected.size>0,enter:id=>selected.add(id),toggle:id=>selected.has(id)?selected.delete(id):selected.add(id),open:id=>opened.push(id),schedule:f=>{timers.set(++sequence,f);return sequence;},cancelTimer:id=>timers.delete(id)});
 function send(type,index=0,props={}){const event=new Event(type,{cancelable:true});Object.defineProperties(event,Object.fromEntries(Object.entries({target:cards[index],pointerId:1,isPrimary:true,button:0,clientX:0,clientY:0,...props}).map(([k,value])=>[k,{value}])));(type==='click'||type==='keydown'?list:doc).dispatchEvent(event);return event;}
 const hold=()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(f=>f());};
 return {send,hold,selected,opened,stop,timers};
}
test('long press selects its receipt once; release click is consumed, next tap deselects',()=>{
 const f=fixture();f.send('pointerdown');f.hold();assert.deepEqual([...f.selected],['a']);f.send('pointerup');assert.equal(f.send('click').defaultPrevented,true);assert.deepEqual([...f.selected],['a']);assert.deepEqual(f.opened,[]);
 f.send('pointerdown');f.send('pointerup');f.send('click');assert.equal(f.selected.size,0);
 f.send('pointerdown',1);f.send('pointerup',1);f.send('click',1);assert.deepEqual(f.opened,['b']);
});
test('short click opens details; tap in selection adds a different receipt',()=>{
 const f=fixture();f.send('pointerdown');f.send('pointerup');f.hold();f.send('click');assert.deepEqual(f.opened,['a']);
 f.send('pointerdown');f.hold();f.send('pointerup');f.send('click');f.send('pointerdown',1);f.send('pointerup',1);f.send('click',1);assert.deepEqual([...f.selected],['a','b']);
});
test('movement, scrolling, cancellation and another finger cancel the pending hold',()=>{
 for(const [type,props] of [['pointermove',{clientY:20}],['scroll',{}],['pointercancel',{}],['pointerdown',{pointerId:2,isPrimary:false}]]){const f=fixture();f.send('pointerdown');f.send(type,0,props);f.hold();assert.equal(f.selected.size,0,type);}
});
test('Shift+Space supports keyboard selection and cleanup cancels pending gestures',()=>{
 const f=fixture();assert.equal(f.send('keydown',0,{shiftKey:true,code:'Space'}).defaultPrevented,true);assert.deepEqual([...f.selected],['a']);f.send('keydown',0,{shiftKey:true,code:'Space'});assert.equal(f.selected.size,0);f.send('pointerdown');f.stop();f.hold();assert.equal(f.selected.size,0);
});
test('keyboard activation still works if the browser omits the hold release click',()=>{
 const f=fixture();f.send('pointerdown');f.hold();f.send('pointerup');f.send('keydown',0,{key:'Enter'});f.send('click');assert.equal(f.selected.size,0);
});
