import test from "node:test";
import assert from "node:assert/strict";
import { retryRegion, mergeRecognition } from "../src/recognition-retry.js";
import { parseReceipt } from "../src/core.js";
const base = {
  Type: "微信支付截图",
  PaymentKind: "商户支付",
  Amount: "12.00",
  Payee: "测试商店",
  Traded: "2026-10-15 12:00:00",
  Transaction: "4500000000202610151234567890",
  TradeStatus: "支付成功",
};
const item = (text, y) => ({
  text,
  poly: [
    [70, y],
    [700, y],
    [700, y + 40],
    [70, y + 40],
  ],
});
test("complete core fields never trigger an extra OCR pass, including a refund warning", () => {
  assert.equal(retryRegion([], base, 1320, 2868), null);
  assert.equal(
    retryRegion(
      [],
      { ...base, TradeStatus: "已退款(¥2.00)", RefundAmount: "2.00" },
      1320,
      2868,
    ),
    null,
  );
});
test("retry keeps whole rows but only scans the missing anchored order, even near image bottom", () => {
  const region = retryRegion(
    [item("交易单号", 2700)],
    { ...base, Transaction: "" },
    1320,
    2868,
  );
  assert.equal(region.targeted, true);
  assert.equal(region.width, 1320);
  assert.ok(region.y < 2700);
  assert.equal(region.y + region.height, 2868);
  assert.ok(region.height < 2868 * 0.25);
});
test("multiple missing fields share one crop; unavailable anchors or headline amount keep a broad fallback", () => {
  const region = retryRegion(
    [item("支付时间", 1000), item("交易单号", 1500)],
    { ...base, Transaction: "bad", Traded: "" },
    1320,
    2868,
  );
  assert.equal(region.targeted, true);
  assert.ok(region.y < 1000 && region.y + region.height > 1540);
  assert.equal(
    retryRegion([], { ...base, Transaction: "" }, 1320, 2868).targeted,
    false,
  );
  assert.equal(
    retryRegion([item("交易单号", 1500)], { ...base, Amount: "" }, 1320, 2868)
      .targeted,
    false,
  );
});
test("a valid retry repairs nonempty invalid amount/date/order without replacing valid originals", () => {
  const first = {
      fields: {
        ...base,
        Amount: "12.000",
        Traded: "2026-02-30 12:00:00",
        Transaction: "45O0000000202610151234567890",
      },
      raw: "full image",
    },
    second = {
      fields: { ...base, Payee: "different merchant", Amount: "12.00" },
    };
  const merged = mergeRecognition(first, second);
  assert.equal(merged.fields.Amount, "12.00");
  assert.equal(merged.fields.Traded, base.Traded);
  assert.equal(merged.fields.Transaction, base.Transaction);
  assert.equal(merged.fields.Payee, base.Payee);
  assert.equal(merged.warning, "");
  assert.equal(first.fields.Amount, "12.000");
  assert.equal(
    mergeRecognition(
      { fields: base },
      { fields: { ...base, Amount: "999.00" } },
    ).fields.Amount,
    "12.00",
  );
  assert.equal(
    mergeRecognition(first, {
      fields: { Amount: "bad", Traded: "bad", Transaction: "bad" },
    }).fields.Amount,
    "12.000",
  );
});
test("cropped transfer time can be recovered without borrowing the received time", () => {
  const second = parseReceipt(
    ["转账时间 2026年10月15日12:00:00", "收款时间 2026年10月15日12:05:00"],
    null,
    "微信支付截图",
  );
  const merged = mergeRecognition(
    {
      fields: {
        ...base,
        PaymentKind: "个人转账",
        Transaction: "1000050001202610150123456789012",
        Traded: "",
      },
    },
    second,
  );
  assert.equal(merged.fields.Traded, base.Traded);
  assert.equal(merged.fields.PaymentKind, "个人转账");
});

test("partial fallback text cannot promote an unknown receipt to a trusted payment type", () => {
  const merged = mergeRecognition(
    { fields: { Type: "其他凭证" } },
    { fields: { Type: "微信支付截图", Payee: "uncertain name" } },
  );
  assert.equal(merged.fields.Type, "其他凭证");
});
