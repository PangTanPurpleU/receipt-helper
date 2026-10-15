import { adaptiveDate } from "./adaptive.js";
export const isAdaptive = (f) => f?.Type === "通用凭证";
export const receiptTypes = [
  "微信支付电子凭证",
  "微信支付转账电子凭证",
  "支付宝支付截图",
  "微信支付截图",
  "通用凭证",
  "其他凭证",
];
export const isAlipay = (f) => f?.Type === "支付宝支付截图";
export const isWechatScreenshot = (f) => f?.Type === "微信支付截图";
export const isScreenshot = (f) => isAlipay(f) || isWechatScreenshot(f);
export function orderDomain(f) {
  return isAdaptive(f)
    ? JSON.stringify([
        "adaptive",
        f.Source || "",
        f.Payee || "",
        f.Amount || "",
        f.Traded || "",
      ])
    : isAlipay(f)
      ? "alipay"
      : isWechatScreenshot(f)
        ? f.PaymentKind === "个人转账"
          ? "wechat-transfer"
          : "wechat-pay"
        : f?.Type?.includes("转账")
          ? "wechat-transfer"
          : f?.Type?.includes("微信")
            ? "wechat-pay"
            : "other";
}
export function validOrderIdentifier(f) {
  const s = f?.Transaction || "";
  return isAdaptive(f)
    ? /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(s)
    : isWechatScreenshot(f)
      ? /^(?:42|45)(?:\d{26}|\d{30})$/.test(s) || /^1000\d{27,28}$/.test(s)
      : isAlipay(f)
        ? /^20\d{22,38}$/.test(s)
        : f?.Type?.includes("转账")
          ? /^\d{20,40}$/.test(s)
          : /^(?:\d{28}|\d{32})$/.test(s);
}
export function validReceiptOrder(f) {
  return (
    validOrderIdentifier(f) &&
    (!isAdaptive(f) ||
      Boolean(
        f.Payee &&
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(f.Traded || "") &&
          adaptiveDate(f.Traded) !== null &&
          /^\d+(?:\.\d{1,2})?$/.test(f.Amount || "") &&
          Number(f.Amount) > 0,
      ))
  );
}
export const screenshotFields = [
  ["Traded", "支付时间"],
  ["Amount", "支付金额（元）"],
  ["Payee", "收款方"],
  ["Transaction", "订单号"],
  ["PayeeFullName", "收款方全称"],
  ["PayeeDisplayName", "商户显示名称"],
  ["MerchantOrder", "商家订单号"],
  ["PaymentMethod", "付款方式"],
  ["ProductDescription", "商品说明"],
  ["TradeStatus", "交易状态"],
  ["OrderAmount", "订单金额"],
  ["Discount", "优惠信息"],
  ["RideTime", "乘车时间"],
  ["Acquirer", "收单机构"],
  ["ClearingInstitution", "清算机构"],
  ["Note", "备注"],
];

export function wechatScreenshotFields(f) {
  const transfer = f.PaymentKind === "个人转账",
    qr = f.PaymentKind === "扫码付款";
  return [
    ["Traded", transfer || qr ? "转账时间" : "支付时间"],
    ["Amount", "支付金额（元）"],
    ["Payee", "收款方"],
    ["Transaction", transfer || qr ? "转账单号" : "交易单号"],
    ["PaymentKind", "支付类型"],
    ["PayeeFullName", "商户全称"],
    ["PayeeDisplayName", "商户显示名称"],
    ["MerchantOrder", "商户单号"],
    ["PaymentMethod", "支付方式"],
    ["ProductDescription", "商品"],
    ["TradeStatus", "当前状态"],
    ["TransferNote", "转账说明/收款方备注"],
    ["Received", "收款时间"],
    ["OrderAmount", "原价"],
    ["Discount", "优惠信息"],
    ["RefundAmount", "退款金额（元）"],
    ["RefundTime", "退款时间"],
    ["Acquirer", "收单机构"],
    ["Note", "备注"],
  ].filter(
    ([key], i) =>
      i < 4 ||
      ["ProductDescription", "Note", "PaymentKind"].includes(key) ||
      f[key],
  );
}
