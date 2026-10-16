import { adaptiveDate } from "./adaptive.js";
import {
  amountCents,
  amountConflict,
  moneyChinese,
  dateValue,
  needsRecognitionRetry,
  parseReceipt,
} from "./core.js";
import {
  isAdaptive,
  isAlipay,
  isScreenshot,
  isWechatScreenshot,
  validOrderIdentifier,
  validReceiptOrder,
} from "./receipt-types.js";

// Preserve full-width label/value rows. Only narrow the vertical region when
// every missing core field has a visible anchor; otherwise keep a broad crop.
export function retryRegion(items, fields, width, height) {
  if (!needsRecognitionRetry({ fields })) return null;
  const fallback = {
    x: 0,
    y: Math.round(height * 0.08),
    width,
    height: height - Math.round(height * 0.08),
    targeted: false,
  };
  if (!fields.Type || fields.Type === "其他凭证" || isAdaptive(fields)) {
    const points = items
      .flatMap((i) => i.poly || [])
      .filter((p) => p.every(Number.isFinite));
    if (!points.length) return { ...fallback, y: 0, height };
    const left = Math.max(
        0,
        Math.floor(Math.min(...points.map((p) => p[0])) - 48),
      ),
      top = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1])) - 64)),
      right = Math.min(
        width,
        Math.ceil(Math.max(...points.map((p) => p[0])) + 48),
      ),
      bottom = Math.min(
        height,
        Math.ceil(Math.max(...points.map((p) => p[1])) + 96),
      );
    return right > left && bottom > top
      ? {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          targeted: (right - left) * (bottom - top) < width * height * 0.85,
        }
      : { ...fallback, y: 0, height };
  }
  const hidden = fields.Type.includes("转账"),
    transferTime =
      hidden ||
      (isWechatScreenshot(fields) && fields.PaymentKind !== "商户支付"),
    anchors = [];
  if (!validReceiptOrder(fields))
    anchors.push(isAlipay(fields) ? /^订单号/ : /^(?:交易|转[账帳帐])单号/);
  if (amountCents(fields.Amount) === null || amountConflict(fields)) {
    if (isScreenshot(fields)) return fallback;
    anchors.push(/^(?:交易金额)?小写/);
  }
  if (!dateValue(fields.Traded))
    anchors.push(
      transferTime
        ? /^转[账帳帐]时间/
        : isScreenshot(fields)
          ? /^(?:支付|付款)时间/
          : /^交易时间/,
    );
  if (!hidden && !fields.Payee)
    anchors.push(
      isWechatScreenshot(fields)
        ? /^商户全称/
        : /^(?:商户简称|收款方(?!备注|服务|说明|账号))/,
    );
  if (!isScreenshot(fields) && !fields.Payer)
    anchors.push(/^(?:付款方(?!账号)|姓名)/);
  const boxes = [];
  for (const label of anchors) {
    const item = items.find(
      (i) =>
        label.test(
          String(i.text || "")
            .normalize("NFKC")
            .replace(/\s+/g, ""),
        ) && i.poly?.length,
    );
    if (!item) return fallback;
    const ys = item.poly.map((p) => p[1]);
    if (ys.some((y) => !Number.isFinite(y))) return fallback;
    boxes.push([Math.min(...ys), Math.max(...ys)]);
  }
  if (!boxes.length) return fallback;
  const top = Math.max(
      0,
      Math.floor(
        Math.min(...boxes.map((b) => b[0])) - Math.max(64, height * 0.035),
      ),
    ),
    bottom = Math.min(
      height,
      Math.ceil(
        Math.max(...boxes.map((b) => b[1])) + Math.max(140, height * 0.075),
      ),
    );
  return bottom > top
    ? { x: 0, y: top, width, height: bottom - top, targeted: true }
    : fallback;
}
export function mergeRecognition(first, second) {
  const fields = { ...first.fields };
  if (
    validOrderIdentifier(fields) &&
    validOrderIdentifier(second.fields) &&
    fields.Transaction !== second.fields.Transaction
  )
    return { ...first };
  if (
    (fields.Type === "其他凭证" || isAdaptive(fields)) &&
    second.fields.Type &&
    second.fields.Type !== "其他凭证" &&
    !needsRecognitionRetry(second)
  )
    fields.Type = second.fields.Type;
  for (const [key, value] of Object.entries(second.fields)) {
    if (!value) continue;
    if (key === "Amount") {
      if (
        (amountCents(fields.Amount) === null ||
          (amountConflict(fields) &&
            amountCents(value) ===
              amountCents(moneyChinese(fields.AmountChinese)))) &&
        amountCents(value) !== null
      )
        fields[key] = value;
    } else if (key === "Transaction") {
      if (
        !validOrderIdentifier(fields) &&
        validOrderIdentifier({ ...fields, Transaction: value })
      )
        fields[key] = value;
    } else if (key === "Traded") {
      if (
        !(isAdaptive(fields)
          ? adaptiveDate(fields.Traded)
          : dateValue(fields.Traded)) &&
        (isAdaptive(fields) ? adaptiveDate(value) : dateValue(value))
      )
        fields[key] = value;
    } else if (!fields[key]) fields[key] = value;
  }
  const validated = parseReceipt([], fields);
  return { ...first, fields, warning: validated.warning };
}
