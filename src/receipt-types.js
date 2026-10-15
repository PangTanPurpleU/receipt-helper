export const receiptTypes=['微信支付电子凭证','微信支付转账电子凭证','支付宝支付截图','其他凭证'];
export const isAlipay=f=>f?.Type==='支付宝支付截图';
export function orderDomain(f){return isAlipay(f)?'alipay':f?.Type?.includes('转账')?'wechat-transfer':f?.Type?.includes('微信')?'wechat-pay':'other';}
export function validReceiptOrder(f){const s=f?.Transaction||'';return isAlipay(f)?/^20\d{22,38}$/.test(s):f?.Type?.includes('转账')?/^\d{20,40}$/.test(s):/^(?:\d{28}|\d{32})$/.test(s);}
export const screenshotFields=[['Traded','支付时间'],['Amount','支付金额（元）'],['Payee','收款方'],['Transaction','订单号'],['PayeeFullName','收款方全称'],['PayeeDisplayName','商户显示名称'],['MerchantOrder','商家订单号'],['PaymentMethod','付款方式'],['ProductDescription','商品说明'],['TradeStatus','交易状态'],['OrderAmount','订单金额'],['Discount','优惠信息'],['RideTime','乘车时间'],['Acquirer','收单机构'],['ClearingInstitution','清算机构'],['Note','备注']];
