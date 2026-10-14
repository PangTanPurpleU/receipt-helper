import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {orderedLines,parseReceipt,amountCents,dateValue,peerMap,summary,payee,reasons} from '../src/core.js';
import {exportExcel} from '../src/excel.js';
const base={Type:'微信支付电子凭证',Transaction:'1234567890123456789012345678',Amount:'55.00',AmountChinese:'伍拾伍元整',Payee:'测试餐厅',Payer:'测试人',Traded:'2026-01-19 19:10:41'};
test('split long transaction, 515 amount, and payee warning regressions',()=>{const r=parseReceipt(['微信支付电子凭证','交易单号 123456789012345678','9012345678','付款方 姓名:测试人','商户简称:测试加油站','交易金额 小写:515.00元','大写:伍佰壹拾伍元整','交易时间:2026-01-0120:58:46']);assert.equal(r.fields.Transaction,'1234567890123456789012345678');assert.equal(r.fields.Amount,'515.00');assert.equal(r.warning,'');assert.equal(parseReceipt([],base).warning,'');});
test('transfer recipient remains hidden; not missing or duplicated from masked names',()=>{const r=parseReceipt(['微信支付转账电子凭证','转账单号1234567890123456789012345678901','付款方 姓名:测试人','收款方 姓名:***','小写:210.00元','大写:贰佰壹拾元整','转账时间2026-07-2209:43:59']);assert.equal(payee(r),'收款方已隐藏');assert.equal(r.fields.PayeeStatus,'hidden');assert.equal(r.warning,'');});
test('strict cents/date validation and conflicting uppercase amount',()=>{assert.equal(amountCents('515.00'),51500);assert.equal(amountCents('5.155'),null);assert.equal(amountCents('-2'),null);assert.equal(dateValue('2026-02-30 12:00:00'),null);assert.match(parseReceipt([],{...base,Amount:'515.00'}).warning,/大小写不一致/);assert.equal(summary([{fields:{Amount:'0.10'}},{fields:{Amount:'0.20'}}]).value,'0.30');});
test('duplicate decisions distinguish same amount from same transaction and ignore masked parties',()=>{const a={id:'a',fields:base},b={id:'b',fields:{...base,Transaction:'2234567890123456789012345678',Traded:'2026-01-20 12:00:00'}};assert.equal(peerMap([a,b]).size,0);assert.equal(peerMap([a,{...a,id:'c'}]).size,2);assert.equal(peerMap([{...a,fields:{...base,Type:'微信支付转账电子凭证',Transaction:'',Payee:''}},{...a,id:'b',fields:{...base,Type:'微信支付转账电子凭证',Transaction:'',Payee:''}}]).size,0);});
test('xlsx keeps root relationships, exact five columns, total, ascending dates, text IDs and red duplicate style',async()=>{const rows=[{id:'a',fields:{...base,Traded:'2026-01-20 12:00:00'}},{id:'b',fields:base}];const blob=await exportExcel(rows),zip=await JSZip.loadAsync(await blob.arrayBuffer());assert.ok(zip.file('_rels/.rels'));const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/<f>SUM\(B3:B4\)<\/f><v>110.00<\/v>/);assert.match(xml,/<c r="D3" s="0" t="inlineStr"/);assert.match(xml,/<c r="E3" s="3"/);assert.ok(xml.indexOf('46041.79908564815')!==-1||xml.includes('46041.799'));assert.equal((xml.match(/<row /g)||[]).length,4);const styles=await zip.file('xl/styles.xml').async('string');assert.match(styles,/FFB42318/);});

test('published OCR traditional merchant label is excluded from payee',()=>{const r=parseReceipt(['微信支付电子凭证','收款方商戶简称：虚构星云文具店','交易单号：4200000000202610141234567890','付款方姓名：测试用户甲','小写：128.50 元','大写：壹佰贰拾捌元伍角','交易时间：2026-10-1409:10:11']);assert.equal(r.fields.Payee,'虚构星云文具店');assert.equal(r.warning,'');});

test('indexed duplicate lookup preserves all evidence and peer ordering',()=>{
 const rows=[];
 for(let i=0;i<180;i++)rows.push({id:String(i),hash:i%7===0?'same-photo':String(i),fields:{
  ...base,Type:i%4===0?'微信支付转账电子凭证':'微信支付电子凭证',
  Transaction:i%3===0?base.Transaction:i%3===1?'':String(i).padStart(28,'0'),
  Certificate:i%5===0?'same-certificate':'',MerchantOrder:i%6===0?'same-merchant':'',
  Amount:['55.00','55','0','bad'][i%4],Traded:i%8===0?'2026-02-30 12:00:00':base.Traded,
  Payer:i%9===0?'':i%2?'测 试人':'测试人',Payee:i%10===0?'':i%2?'测试 餐厅':'测试餐厅'
 }});
 rows.push({...rows[1],id:'delimiter-a',fields:{...base,Payer:'a|b',Payee:'c',Transaction:''}});
 rows.push({...rows[1],id:'delimiter-b',fields:{...base,Payer:'a',Payee:'b|c',Transaction:''}});
 const expected=new Map();
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const evidence=reasons(rows[i],rows[j]);if(!evidence.length)continue;
  for(const [a,b] of [[i,j],[j,i]]){if(!expected.has(rows[a].id))expected.set(rows[a].id,[]);expected.get(rows[a].id).push({id:rows[b].id,reasons:evidence});}
 }
 assert.deepEqual(peerMap(rows),expected);
});

test('merged payer/payee cells cannot steal values from the adjacent name row',()=>{
 const item=(text,x,y,w=100,h=54)=>({text,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
 const items=[item('微信支付转账电子凭证',400,100),item('付款方',100,632),item('姓名',400,666,87,52),item('测试甲',1100,660,118),item('微信号',400,598),item('wxid_test',1000,600),item('收款方',100,767),item('姓名',400,801),item('测试乙',1100,801)];
 const lines=orderedLines(items);assert.ok(lines.includes('姓名 测试甲'));assert.equal(parseReceipt(lines).fields.Payer,'测试甲');
 assert.equal(parseReceipt(['微信支付转账电子凭证','付款方','姓名','收款方','姓名 测试乙']).fields.Payer,'');
 assert.equal(parseReceipt(['微信支付转账电子凭证','付款方 测试甲','姓名','收款方','姓名 测试乙']).fields.Payer,'测试甲');
});

test('single-row recipient labels stay paired with earlier baseline names without stealing merged name rows',()=>{
 const item=(text,x,y,w=100,h=48)=>({text,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
 const lines=orderedLines([item('微信支付电子凭证',300,100),item('姓名：测试付款人',450,1050),item('收款方',253,1127,106,49),item('光头龙虾',453,1119,143,47),item('交易金额',250,1200),item('小写：848.00',450,1200)]);
 assert.ok(lines.includes('收款方 光头龙虾'));assert.equal(parseReceipt(lines).fields.Payee,'光头龙虾');assert.equal(parseReceipt(lines).fields.Payer,'测试付款人');
 const reversed=orderedLines([item('微信支付电子凭证',300,100),item('收款方',253,1119),item('·w·☒☒',453,1127)]);
 assert.equal(parseReceipt(reversed).fields.Payee,'w');
});
test('garbled recipient retains Chinese, Latin letters and digits without importing remarks or transfer recipients',()=>{
 const parse=value=>parseReceipt(['微信支付电子凭证','收款方 '+value,'收/付款方备注 收款方说明：二维码收款']).fields.Payee;
 assert.equal(parse('□光★头龙虾A12🙂'),'光头龙虾A12');assert.equal(parse('·w·'),'w');assert.equal(parse('＊＊□'),'');
 assert.equal(parse('测试有限公司（分店）'),'测试有限公司(分店)');assert.equal(parse('星·云商店'),'星·云商店');
 assert.equal(parseReceipt(['微信支付电子凭证','收款方','交易金额 小写32.00','收/付款方备注 收款方说明：二维码收款']).fields.Payee,'');
 assert.equal(parseReceipt(['微信支付转账电子凭证','收款方 ·w·']).fields.Payee,'');
});
