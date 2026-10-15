// WeChat bill screenshots differ from electronic certificates: the amount and
// recipient are in the header, while payment, receipt and refund dates coexist.
const compact=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'').replace(/[−–—﹣]/g,'-');
const boundary=/^(?:当前状态|支付时间|转账时间|收款时间|商品|商户全称|收单机构|支付方式|交易单号|转账单号|商户单号|转账说明|收款方备注|退款记录|原价|优惠|商家小程序|账单服务|收款方服务|联系商家)/;
export function isWechatLines(input){const t=input.map(compact).join('\n'),signals=[/当前状态/,/支付方式/,/支付时间|转账时间/,/交易单号|转账单号/,/商品|转账说明|收款方备注/];return /(?:^|\n)[xX×]?账单\n/.test(t)&&signals.filter(re=>re.test(t)).length>=3&&!/(?:^|\n)微信支付(?:转账)?电子凭证/.test(t);}
export function parseWechat(input){
 const all=input.flatMap(s=>s.split('\n')).map(compact).filter(Boolean),end=all.findIndex(s=>/^(?:商家小程序|账单服务|收款方服务|联系商家)/.test(s)),lines=end<0?all:all.slice(0,end);
 function value(label,join=false){for(let i=0;i<lines.length;i++){const m=new RegExp('^(?:'+label+')[:：]?').exec(lines[i]);if(!m)continue;let v=lines[i].slice(m[0].length);for(let j=i+1;j<Math.min(lines.length,i+5);j++){if(boundary.test(lines[j]))break;if(!v||join)v+=lines[j];else break;}return v.replace(/[>›》]+$/,'');}return '';}
 function date(s){const m=s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(\d{2}:\d{2}:\d{2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')} ${m[4]}`:'';}
 const headerEnd=lines.findIndex(s=>boundary.test(s)),amountIndex=lines.findIndex((s,i)=>(headerEnd<0||i<headerEnd)&&/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(s));
 const raw=amountIndex<0?'':lines[amountIndex],display=amountIndex>0?lines[amountIndex-1]:'',kind=/^扫二维码付款/.test(display)?'扫码付款':/^转账-转给/.test(display)?'个人转账':'商户支付';
 const full=value('商户全称',true),recipient=display.replace(/^(?:扫二维码付款-给|转账-转给)/,'');
 const merchant=value('商户单号',true),transaction=value('交易单号|转账单号',true),refund=value('退款记录',true),status=value('当前状态');
 const f={Type:'微信支付截图',PaymentKind:kind,Amount:raw.replace(/^[+-]/,'').replaceAll(',',''),Traded:date(value(kind==='商户支付'?'支付时间':'转账时间'))||date(value(kind==='商户支付'?'转账时间':'支付时间')),Payee:full||recipient,Transaction:/^\d+$/.test(transaction)?transaction:'',PayeeFullName:full,PayeeDisplayName:recipient,
 ProductDescription:value('商品',true),MerchantOrder:/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(merchant)?merchant:'',PaymentMethod:value('支付方式'),TradeStatus:status,Acquirer:value('收单机构'),TransferNote:value('转账说明|收款方备注',true),Received:date(value('收款时间')),OrderAmount:value('原价').replace(/[¥￥,]/g,''),Discount:value('优惠',true),RefundAmount:(refund.match(/已退款[¥￥]?(\d+\.\d{2})/)||status.match(/已退款\([¥￥]?(\d+\.\d{2})\)/)||[])[1]||'',RefundTime:date(refund),Direction:raw.startsWith('-')?'支出':raw?'收入':''};
 // A barcode's printable merchant order may follow an instructional label.
 // Keep it separate from the authoritative transaction/transfer number.
 if(!f.MerchantOrder&&/扫码退款/.test(merchant)){const candidate=merchant.match(/(\d{16,40})$/);if(candidate)f.MerchantOrder=candidate[1];}
 return f;
}
