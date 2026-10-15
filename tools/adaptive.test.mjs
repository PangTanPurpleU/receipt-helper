import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceipt,needsRecognitionRetry,peerMap,receiptFieldDefs,orderedLines} from '../src/core.js';
import {mergeRecognition,retryRegion} from '../src/recognition-retry.js';
const bank=['云川银行电子回单','收款人：星河餐厅','付款人：测试客户','交易日期：2026/10/15 09:08:07','实际支付：人民币 1,280.50 元','交易流水号：AB_001234567890','摘要：会议用餐','银行名称：云川银行'];
test('unfamiliar bank layouts extract useful fields without impersonating WeChat',()=>{
 const r=parseReceipt(bank);assert.deepEqual(r.fields,{Type:'通用凭证',Amount:'1280.50',Traded:'2026-10-15 09:08:07',Payee:'星河餐厅',Payer:'测试客户',Transaction:'AB_001234567890',ProductDescription:'会议用餐',Source:'云川银行'});assert.equal(r.warning,'');assert.equal(needsRecognitionRetry(r),false);assert.ok(receiptFieldDefs(r.fields).some(([k])=>k==='ProductDescription'));
});
test('date-only receipts preserve precision and do not require a payer or an absent order',()=>{
 const r=parseReceipt(['星河便利店','日期','2026年10月15日','商品名称：矿泉水','合计：6.50']);assert.equal(r.fields.Amount,'6.50');assert.equal(r.fields.Payee,'星河便利店');assert.equal(r.fields.Traded,'2026-10-15');assert.equal(r.warning,'');assert.equal(needsRecognitionRetry(r),false);
});
test('actual paid amount outranks gross total; discounts and refunds are not payment amounts',()=>{
 const r=parseReceipt([...bank,'合计：1300.50','优惠：20.00','退款金额：10.00']);assert.equal(r.fields.Amount,'1280.50');assert.equal(parseReceipt(['日期：2026-10-15','商户名称：星河便利店','优惠：20.00','退款金额：10.00']).fields.Amount,undefined);
});
test('conflicting same-priority totals and impossible dates request a bounded retry',()=>{
 const r=parseReceipt(['商户名称：星河便利店','金额：10.00','金额：20.00','交易日期：2026-02-30']);assert.equal(r.fields.Amount,undefined);assert.equal(needsRecognitionRetry(r),true);assert.match(r.warning,/金额/);assert.match(r.warning,/时间/);
 const m=mergeRecognition(r,parseReceipt(['实付金额：10.00','日期：2026-10-15']));assert.equal(m.fields.Amount,'10.00');assert.equal(m.fields.Traded,'2026-10-15');assert.equal(m.fields.Payee,'星河便利店');assert.equal(m.warning,'');
});
test('unknown layout retry retains headings and crops around detected content',()=>{
 const f={Type:'通用凭证'},r=retryRegion([{text:'交易金额',poly:[[100,50],[800,50],[800,700],[100,700]]}],f,1000,2000);assert.equal(r.y,0);assert.equal(r.targeted,true);assert.ok(r.width<1000&&r.height<2000);assert.equal(retryRegion([],f,1000,2000).height,2000);
});
test('generic order dedupe requires matching event evidence, not just a shared sequence number',()=>{
 const fields=parseReceipt(bank).fields,row=(id,f)=>({id,fields:f});assert.equal(peerMap([row('a',fields),row('b',{...fields})]).size,2);
 for(const change of [{Source:'另一家银行'},{Payee:'另一家餐厅'},{Amount:'200.00'},{Traded:'2026-10-15 09:08:08'},{Traded:'2026-10-15'}])assert.equal(peerMap([row('a',fields),row('b',{...fields,...change})]).size,0);
 const day={...fields,Traded:'2026-10-15'};assert.equal(peerMap([row('a',day),row('b',day)]).size,0);
});
test('OCR geometric rows support unfamiliar columns and standalone labels',()=>{
 const box=(text,x,y)=>({text,poly:[[x,y],[x+100,y],[x+100,y+20],[x,y+20]]});const r=parseReceipt(orderedLines([box('商户名称',10,10),box('星河餐厅',300,10),box('实付金额',10,50),box('66.00',300,50),box('日期',10,90),box('2026-10-15',300,90)]));assert.equal(r.fields.Amount,'66.00');assert.equal(r.fields.Payee,'星河餐厅');assert.equal(r.warning,'');
});
test('generic Excel export retains product and issuer, and leaves date-only values as text',async()=>{
 const {exportExcel}=await import('../src/excel.js'),{default:JSZip}=await import('jszip');
 for(const others of [[],[{id:'wechat',fields:{Type:'微信支付截图',PaymentKind:'商户支付',Amount:'12.00'}}]]){
 const f={...parseReceipt(bank).fields,Traded:'2026-10-15'},blob=await exportExcel([{id:'generic',fields:f},...others]),z=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await z.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/会议用餐/);assert.match(xml,/出具机构/);assert.match(xml,/云川银行/);assert.match(xml,/2026-10-15/);
 }
});
test('a bank receipt with uppercase and payer labels is not mistaken for a WeChat certificate',()=>{
 const r=parseReceipt([...bank,'付款方：测试客户','小写：1280.50元','大写：壹仟贰佰捌拾元伍角']);assert.equal(r.fields.Type,'通用凭证');assert.equal(r.fields.Payee,'星河餐厅');
});
test('a single standalone currency amount is usable, but an ambiguous pair is not guessed',()=>{
 const base=['商户名称：星河便利店','日期：2026-10-15'];assert.equal(parseReceipt([...base,'￥12.80']).fields.Amount,'12.80');assert.equal(parseReceipt([...base,'-12.80']).fields.Amount,'12.80');assert.equal(parseReceipt([...base,'￥12.80','￥20.00']).fields.Amount,undefined);assert.equal(parseReceipt([...base,'金额：???','￥20.00']).fields.Amount,undefined);
});
test('unreadable actual payment never silently falls back to a readable gross total',()=>{
 const r=parseReceipt(['商户名称：星河便利店','日期：2026-10-15','实付金额：???','合计：100.00']);assert.equal(r.fields.Amount,undefined);assert.equal(needsRecognitionRetry(r),true);
 const conflict=parseReceipt(['实付金额：12.00','实付金额：???','合计：20.00']);assert.equal(conflict.fields.Amount,undefined);
});
test('labelled fields sharing a row are separated without splitting ordinary description words',()=>{
 const r=parseReceipt(['商户名称：星河便利店   日期：2026-10-15','实付金额：12.80   订单号：TEST123456','商品说明：矿泉水 两瓶']);assert.equal(r.fields.Amount,'12.80');assert.equal(r.fields.Traded,'2026-10-15');assert.equal(r.fields.Transaction,'TEST123456');assert.equal(r.fields.ProductDescription,'矿泉水 两瓶');assert.equal(r.warning,'');
});
test('an empty actual-paid label does not fall back to gross totals or standalone amounts',()=>{
 for(const label of ['实付金额','实付金额：']){const r=parseReceipt(['商户名称：星河便利店','日期：2026-10-15',label,'合计：100.00','￥100.00']);assert.equal(r.fields.Amount,undefined);assert.equal(needsRecognitionRetry(r),true);}
});
test('known non-paid statuses and signed income remain explicitly flagged in generic layouts',()=>{
 for(const status of ['待支付','支付失败','交易关闭','退款成功'])assert.match(parseReceipt([...bank,'交易状态：'+status]).warning,/交易状态/);
 assert.equal(parseReceipt([...bank,'交易状态：支付成功']).warning,'');
 assert.match(parseReceipt(['星河便利店','日期：2026-10-15','+12.80']).warning,/收入/);
});
test('retry retains a newly read generic order even when the original date has day precision',()=>{
 const first=parseReceipt(['商户名称：星河便利店','日期：2026-10-15','实付金额：12.80']),second=parseReceipt(['订单号：ORDER123456']);assert.equal(mergeRecognition(first,second).fields.Transaction,'ORDER123456');
});
test('invalid dates or absent amounts cannot give a generic order authoritative duplicate evidence',()=>{
 const f=parseReceipt(bank).fields;for(const change of [{Traded:'2026-02-30 09:08:07'},{Amount:''},{Amount:'0.00'}]){const fields={...f,...change};assert.equal(peerMap([{id:'a',fields},{id:'b',fields}]).size,0);}
});
test('generic date-only rows sort by their real day in Excel while remaining text cells',async()=>{
 const {exportExcel}=await import('../src/excel.js'),{default:JSZip}=await import('jszip');const f=parseReceipt(bank).fields;
 const rows=[{id:'later',fields:{...f,Payee:'后一天',Traded:'2026-10-16 09:08:07'}},{id:'earlier',fields:{...f,Payee:'前一天',Traded:'2026-10-15'}}],blob=await exportExcel(rows),z=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await z.file('xl/worksheets/sheet1.xml').async('string');assert.ok(xml.indexOf('前一天')<xml.indexOf('后一天'));assert.match(xml,/<c r="A3"[^>]*t="inlineStr"/);
});
test('a contact WeChat ID does not turn an unfamiliar bank receipt into a WeChat certificate',()=>{
 const r=parseReceipt([...bank,'微信号：客服测试号']);assert.equal(r.fields.Type,'通用凭证');assert.equal(r.fields.Amount,'1280.50');assert.equal(r.fields.Payee,'星河餐厅');
});
