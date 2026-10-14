export const fieldDefs=[['Transaction','交易/转账单号'],['Amount','金额（元）'],['Payee','收款方'],['Payer','付款方'],['Traded','交易/转账时间'],['Applied','申请时间'],['Certificate','凭证编号'],['MerchantOrder','商户单号'],['AmountChinese','金额大写'],['PayerAccount','付款方账号'],['TradeType','交易类型'],['TradeStatus','交易状态'],['TransferNote','收付款方备注'],['Note','备注'],['PayeeAccount','收款方账号'],['Received','收款时间']];
export const norm=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'').replaceAll('：',':');
export const transfer=r=>(r.fields?.Type||'').includes('转账');
export const payee=r=>transfer(r)?'收款方已隐藏':r.fields.Payee||'收款方未识别';
export function validOrder(s,isTransfer=false){return (isTransfer?/^\d{20,40}$/:/^(?:\d{28}|\d{32})$/).test(s||'');}
export function amountCents(s){s=String(s??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;}
export function summary(rows){let cents=0,invalid=0;for(const r of rows){const n=amountCents(r.fields.Amount);if(n===null)invalid++;else cents+=n;}return {cents,invalid,value:(cents/100).toFixed(2)};}
export function dateValue(s){if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s||''))return null;const d=new Date(s.replace(' ','T')+'Z');return !Number.isNaN(+d)&&d.toISOString().slice(0,19).replace('T',' ')===s?+d:null;}
export function moneyChinese(s){s=norm(s).replaceAll('圆','元');if(!/^[零壹贰貳叁參肆伍陆陸柒捌玖拾佰仟万萬亿億]+元(?:整|[零壹贰貳叁參肆伍陆陸柒捌玖]角(?:[零壹贰貳叁參肆伍陆陸柒捌玖]分)?|零?[零壹贰貳叁參肆伍陆陸柒捌玖]分)$/.test(s))return null;const digits={'零':0,'壹':1,'贰':2,'貳':2,'叁':3,'參':3,'肆':4,'伍':5,'陆':6,'陸':6,'柒':7,'捌':8,'玖':9};let total=0,section=0,n=0;for(const c of s.split('元')[0]){if(c in digits)n=digits[c];else {const unit={拾:10,佰:100,仟:1000,万:10000,萬:10000,亿:1e8,億:1e8}[c];if(unit<10000){section+=(n||1)*unit;n=0;}else{total+=(section+n)*unit;section=n=0;}}}let cents=(total+section+n)*100;const tail=s.split('元')[1],j=tail.match(/([零壹贰貳叁參肆伍陆陸柒捌玖])角/),f=tail.match(/([零壹贰貳叁參肆伍陆陸柒捌玖])分/);if(j)cents+=digits[j[1]]*10;if(f)cents+=digits[f[1]];return (cents/100).toFixed(2);}
const labels='申请时间|交易单号|转[账帳帐]单号|商户单号|凭证编号|编号|付款方|收款方|姓名|微信号|商户简称|交易金额|小写|大写|交易时间|转[账帳帐]时间|收款时间|交易类型|交易场景|交易状态|收[/／]付款方备注|转[账帳帐]说明';
// Keep conventional merchant punctuation, but salvage readable characters from
// decorated/garbled names instead of discarding their complete value.
export function cleanPayee(value){
 const text=norm(value),readable=/[\p{Script=Han}A-Za-z0-9]/u;
 const garbled=/[^\p{Script=Han}A-Za-z0-9·&.,，、()（）\-'’]/u.test(text)||/^[·.,，、\-]+|[·,，、\-]+$/u.test(text);
 return garbled?[...text].filter(c=>readable.test(c)).join(''):text;
}
export function orderedLines(items){
 const box=i=>{const p=i.poly;return {...i,x:Math.min(...p.map(p=>p[0])),y:p.reduce((a,p)=>a+p[1],0)/p.length,h:Math.max(...p.map(p=>p[1]))-Math.min(...p.map(p=>p[1]))};};
 const sorted=items.filter(i=>i.text?.trim()&&i.poly?.length).map(box).sort((a,b)=>a.y-b.y);
 // These labels occupy merged table cells between two actual rows. Keeping
 // them out of row grouping prevents them stealing the nearby name value.
 const roles=sorted.filter(i=>/^(?:付款方|收款方)[:：]?$/.test(norm(i.text)));
 const rows=[];for(const i of sorted.filter(i=>!roles.includes(i))){const row=rows.at(-1);if(row&&Math.abs(row[0].y-i.y)<Math.max(row[0].h,i.h)*.55)row.push(i);else rows.push([i]);}
 // A single-row party value shares the label's baseline. Pair only with an
 // unlabelled row; merged party labels must never steal a 姓名/微信号 row.
 const detached=[];for(const role of roles){const candidates=rows.filter(row=>row.every(i=>i.x>role.x&&!new RegExp('^(?:'+labels+')').test(norm(i.text)))&&Math.abs(row[0].y-role.y)<Math.max(row[0].h,role.h)*.55).sort((a,b)=>Math.abs(a[0].y-role.y)-Math.abs(b[0].y-role.y));if(candidates.length)candidates[0].push(role);else detached.push([role]);}
 return [...rows,...detached].sort((a,b)=>a[0].y-b[0].y).map(row=>row.sort((a,b)=>a.x-b.x).map(i=>i.text.trim()).join(' '));
}
export function parseReceipt(input,existing=null){const lines=input.flatMap(s=>s.split('\n')).map(s=>norm(s).replaceAll('甲请时间','申请时间').replaceAll('商戶','商户').replaceAll('商户简祢','商户简称'));const end=lines.findIndex(s=>/^说明:?$/.test(s));const body=end<0?lines:lines.slice(0,end),text=body.join('\n');const f=existing?{...existing}:{};
 function get(label,rows=body){for(let i=0;i<rows.length;i++){const m=new RegExp('(?:'+label+'):?').exec(rows[i]);if(!m)continue;let v=rows[i].slice(m.index+m[0].length).split(new RegExp('(?:'+labels+')'))[0];if(!v&&rows[i+1]&&!new RegExp('^(?:'+labels+')').test(rows[i+1]))v=rows[i+1];if(v)return v.replace(/^[:;]+/,'');}return '';}
 if(!existing){f.Type=/转[账帳帐](?:电子凭证|单号)/.test(text)?'微信支付转账电子凭证':text.includes('微信支付')?'微信支付电子凭证':'其他凭证';const isTransfer=f.Type.includes('转账');
 for(const [k,l] of [['Certificate','(?:凭证)?编号'],['Transaction',isTransfer?'转[账帳帐]单号':'交易单号'],['MerchantOrder','商户单号'],['AmountChinese','大写'],['TradeType',isTransfer?'交易场景':'交易类型'],['TradeStatus','交易状态'],['PayerAccount','微信号'],['TransferNote',isTransfer?'转[账帳帐]说明':'收[/／]付款方备注']])f[k]=get(l);
 // Join only unlabelled numeric continuations, never consume a different numbered field.
 for(const [k,l] of [['Transaction',isTransfer?'转[账帳帐]单号':'交易单号'],['Certificate','(?:凭证)?编号']]){const i=body.findIndex(s=>new RegExp(l).test(s));if(i>=0){let v=get(l,[body[i]]);for(let j=i+1;j<Math.min(body.length,i+4);j++){if(k==='Transaction'&&validOrder(v,isTransfer))break;if(!/^\d+$/.test(body[j]))break;v+=body[j];}f[k]=v;}}
 const recipient=isTransfer?body.findIndex(s=>/^收款方/.test(s)):-1;const payerRows=recipient<0?body:body.slice(0,recipient);f.Payer=get('姓名',payerRows)||get('付款方',payerRows.filter(s=>/^付款方:?.+/.test(s)));if(/^[*＊]+$/.test(f.Payer))f.Payer='';f.Payee=isTransfer?'':get('商户简称')||get('(?<![/／])收款方(?!说明)');if(!isTransfer)f.Payee=cleanPayee(f.Payee.replaceAll('䬸','餐').replace(/^商户简称:?/,''));else f.PayeeStatus='hidden';
 for(const [k,l] of [['Traded',isTransfer?'转[账帳帐]时间':'交易时间'],['Applied','申请时间'],['Received','收款时间']]){const v=get(l);const m=v.match(/(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})/);f[k]=m?m[1]+' '+m[2]:v;}
 const raw=get('小写').replace(/[,，、]/g,'.').match(/([0-9]+(?:\.[0-9]{2})?)(?:元)?$/);const upper=moneyChinese(f.AmountChinese);f.Amount=raw?Number(raw[1]).toFixed(2):upper||'';
 }
 const warnings=[];const isTransfer=f.Type?.includes('转账');if(!validOrder(f.Transaction,isTransfer))warnings.push((isTransfer?'转账单号':'交易单号')+'未识别或不完整，请核对');if(amountCents(f.Amount)===null)warnings.push('金额未识别，请核对');const upper=moneyChinese(f.AmountChinese);if(upper&&f.Amount&&upper!==f.Amount)warnings.push('金额大小写不一致，请核对');if(!f.Payer)warnings.push('付款方未识别，请核对');if(!isTransfer&&!f.Payee)warnings.push('收款方未识别，请核对');if(!dateValue(f.Traded))warnings.push('交易时间未识别，请核对');return {fields:f,warning:warnings.join('；')};}
export function reasons(a,b){if(a.id===b.id)return [];const result=[];if(a.hash&&a.hash===b.hash)result.push('照片内容相同');if(transfer(a)===transfer(b)&&validOrder(a.fields.Transaction,transfer(a))&&a.fields.Transaction===b.fields.Transaction)result.push('交易/转账单号相同');if(a.fields.Certificate&&a.fields.Certificate===b.fields.Certificate)result.push('凭证编号相同');if(!transfer(a)&&!transfer(b)&&a.fields.MerchantOrder&&a.fields.MerchantOrder===b.fields.MerchantOrder&&a.fields.Payee&&norm(a.fields.Payee)===norm(b.fields.Payee))result.push('商户单号及收款方相同');if(!transfer(a)&&!transfer(b)&&amountCents(a.fields.Amount)>0&&a.fields.Amount===b.fields.Amount&&dateValue(a.fields.Traded)&&a.fields.Traded===b.fields.Traded&&a.fields.Payer&&a.fields.Payee&&norm(a.fields.Payer)===norm(b.fields.Payer)&&norm(a.fields.Payee)===norm(b.fields.Payee))result.push('金额、时间、收付款方相同');return result;}
// Index exactly the same evidence as reasons(), then compare only candidate
// pairs. JSON tuple keys avoid delimiter collisions in names and identifiers.
function evidenceKeys(r){
 const f=r.fields,isTransfer=transfer(r),keys=[];
 const key=(...parts)=>keys.push(JSON.stringify(parts));
 if(r.hash)key('photo',r.hash);
 if(validOrder(f.Transaction,isTransfer))key('transaction',isTransfer,f.Transaction);
 if(f.Certificate)key('certificate',f.Certificate);
 if(!isTransfer&&f.MerchantOrder&&f.Payee)key('merchant',f.MerchantOrder,norm(f.Payee));
 if(!isTransfer&&amountCents(f.Amount)>0&&dateValue(f.Traded)&&f.Payer&&f.Payee)key('parties',f.Amount,f.Traded,norm(f.Payer),norm(f.Payee));
 return keys;
}
export function peerMap(rows){
 const m=new Map(),index=new Map(),keys=rows.map(evidenceKeys);
 keys.forEach((list,i)=>{for(const key of list){if(!index.has(key))index.set(key,[]);index.get(key).push(i);}});
 for(let i=0;i<rows.length;i++){
  const candidates=new Set();
  for(const key of keys[i])for(const j of index.get(key))if(j>i)candidates.add(j);
  for(const j of [...candidates].sort((a,b)=>a-b)){
   const why=reasons(rows[i],rows[j]);
   if(!why.length)continue;
   if(!m.has(rows[i].id))m.set(rows[i].id,[]);
   if(!m.has(rows[j].id))m.set(rows[j].id,[]);
   m.get(rows[i].id).push({id:rows[j].id,reasons:why});
   m.get(rows[j].id).push({id:rows[i].id,reasons:why});
  }
 }
 return m;
}
export function filtered(rows,search='',duplicates=false,peers=peerMap(rows)){const q=norm(search).toLowerCase();return rows.filter(r=>(!duplicates||peers.has(r.id))&&(!q||norm([r.name,...Object.values(r.fields)].join(' ')).toLowerCase().includes(q)));}
