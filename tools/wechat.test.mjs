import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  parseReceipt,
  needsRecognitionRetry,
  receiptFieldDefs,
  payee,
  peerMap,
  reasons,
} from "../src/core.js";
import { orderDomain, validReceiptOrder } from "../src/receipt-types.js";
import { exportExcel } from "../src/excel.js";
const order = "4500000123202610151234567890",
  transferOrder = "1000050001202610150123456789012";
const fixture = (extra = [], header = "测试云朵茶店", amount = "-23.60") => [
  "11:28 66",
  "X 账单",
  header,
  amount,
  "当前状态 支付成功",
  "支付时间 2026年10月5日 12:03:04",
  "商品 测试门店-商品A",
  "商户全称 测试云朵餐饮有限公司",
  "收单机构 测试支付机构",
  "支付方式 零钱",
  "交易单号 " + order,
  "商户单号 TEST_PARK_A0O1",
  ...extra,
  "账单服务",
  "申请电子凭证",
];
const personal = () => [
  "账单",
  "转账-转给测试朋友",
  "-3,900.00",
  "当前状态 对方已收钱",
  "转账说明 微信转账",
  "转账时间 2026年10月7日14:46:58",
  "收款时间 2026年10月7日14:47:46",
  "支付方式 零钱",
  "转账单号 " + transferOrder,
  "账单服务",
  "申请转账电子凭证",
];
test("WeChat bill routing accepts close button and service links without confusing certificates", () => {
  const r = parseReceipt(fixture());
  assert.equal(r.fields.Type, "微信支付截图");
  assert.equal(r.fields.Amount, "23.60");
  assert.equal(r.fields.Traded, "2026-10-05 12:03:04");
  assert.equal(r.fields.Payee, "测试云朵餐饮有限公司");
  assert.equal(r.fields.Transaction, order);
  assert.equal(r.warning, "");
  assert.equal(needsRecognitionRetry(r), false);
  assert.equal(
    parseReceipt(
      fixture().filter((s) => s !== "X 账单"),
      null,
      "微信支付截图",
    ).fields.Type,
    "微信支付截图",
  );
  assert.notEqual(
    parseReceipt(["微信支付电子凭证", "交易单号 " + order]).fields.Type,
    "微信支付截图",
  );
  assert.equal(
    parseReceipt(fixture().filter((s) => !s.startsWith("交易单号"))).fields
      .Type,
    "微信支付截图",
  );
  assert.match(
    parseReceipt(fixture().filter((s) => !s.startsWith("当前状态"))).warning,
    /支付状态/,
  );
  assert.notEqual(
    parseReceipt(["普通账单", "交易单号 " + order]).fields.Type,
    "微信支付截图",
  );
});
test("personal transfers retain visible recipient, transfer time and separate received time", () => {
  const r = parseReceipt(personal());
  assert.equal(r.fields.PaymentKind, "个人转账");
  assert.equal(r.fields.Amount, "3900.00");
  assert.equal(r.fields.Payee, "测试朋友");
  assert.equal(payee(r), "测试朋友");
  assert.equal(r.fields.Traded, "2026-10-07 14:46:58");
  assert.equal(r.fields.Received, "2026-10-07 14:47:46");
  assert.equal(r.warning, "");
  assert.equal(orderDomain(r.fields), "wechat-transfer");
  assert.ok(receiptFieldDefs(r.fields).some(([k]) => k === "Payee"));
  const legacy = {
    fields: { Type: "微信支付转账电子凭证", Payee: "测试朋友" },
  };
  assert.equal(payee(legacy), "收款方已隐藏");
});
test("QR receipts use visible header recipient and transfer-number evidence in payment domain", () => {
  const lines = personal()
    .filter((s) => !s.startsWith("收款时间") && !s.startsWith("转账说明"))
    .map((s) =>
      s === "转账-转给测试朋友"
        ? "扫二维码付款-给测试砂锅店"
        : s === "当前状态 对方已收钱"
          ? "当前状态 支付成功"
          : s.startsWith("转账单号")
            ? "转账单号 10001073012026101500123456789012"
            : s,
    );
  const r = parseReceipt(lines);
  assert.equal(r.fields.Payee, "测试砂锅店");
  assert.equal(r.fields.PaymentKind, "扫码付款");
  assert.equal(orderDomain(r.fields), "wechat-pay");
  assert.equal(r.warning, "");
});
test("headline paid amount and payment time win over refund, original price and discount", () => {
  const lines = fixture().map((s) =>
    s === "当前状态 支付成功" ? "当前状态 已退款(¥8.00)" : s,
  );
  lines.splice(
    4,
    0,
    "退款记录 已退款¥8.00>",
    "2026年10月5日13:04:05",
    "原价 ¥30.00",
    "优惠 测试优惠¥6.40",
  );
  const r = parseReceipt(lines);
  assert.equal(r.fields.Amount, "23.60");
  assert.equal(r.fields.Traded, "2026-10-05 12:03:04");
  assert.equal(r.fields.RefundAmount, "8.00");
  assert.equal(r.fields.RefundTime, "2026-10-05 13:04:05");
  assert.equal(r.fields.OrderAmount, "30.00");
  assert.match(r.warning, /退款/);
  assert.equal(needsRecognitionRetry(r), false);
  const noHeader = parseReceipt(lines.filter((s) => s !== "-23.60"));
  assert.equal(noHeader.fields.Amount, "");
  assert.equal(needsRecognitionRetry(noHeader), true);
});
test("multiline products and exact alphanumeric merchant IDs never borrow neighbouring fields", () => {
  const lines = fixture().map((s) =>
    s.startsWith("商品 ")
      ? "商品 测试商城订单-"
      : s.startsWith("交易单号")
        ? "交易单号 45000001232026"
        : s,
  );
  lines.splice(lines.indexOf("商品 测试商城订单-") + 1, 0, "12345");
  lines.splice(
    lines.indexOf("交易单号 45000001232026") + 1,
    0,
    "10151234567890",
  );
  const r = parseReceipt(lines);
  assert.equal(r.fields.ProductDescription, "测试商城订单-12345");
  assert.equal(r.fields.Transaction, order);
  assert.equal(r.fields.MerchantOrder, "TEST_PARK_A0O1");
  assert.equal(
    parseReceipt(
      fixture().map((s) =>
        s.startsWith("商户单号") ? "商户单号 可在支持的商户扫码退款" : s,
      ),
    ).fields.MerchantOrder,
    "",
  );
  assert.equal(
    validReceiptOrder({ ...r.fields, Transaction: order.replace("0", "O") }),
    false,
  );
});
test("missing fields, invalid dates, income and pending transfers stay reviewable", () => {
  assert.equal(
    parseReceipt(fixture().filter((s) => !s.startsWith("支付时间"))).fields
      .Type,
    "微信支付截图",
  );
  assert.match(
    parseReceipt(fixture().filter((s) => !s.startsWith("支付时间"))).warning,
    /时间/,
  );
  assert.match(
    parseReceipt(fixture().map((s) => s.replace("10月5日", "2月30日"))).warning,
    /时间/,
  );
  assert.match(parseReceipt(fixture([], undefined, "+23.60")).warning, /收入/);
  assert.match(
    parseReceipt(
      personal().map((s) =>
        s === "当前状态 对方已收钱" ? "当前状态 待对方收款" : s,
      ),
    ).warning,
    /支付状态/,
  );
  assert.equal(
    validReceiptOrder({
      Type: "微信支付截图",
      Transaction: order.slice(0, -1),
    }),
    false,
  );
});
test("same underlying payment or transfer dedupes across screenshots and electronic certificates", () => {
  const a = { id: "a", fields: parseReceipt(fixture()).fields },
    b = { id: "b", fields: { Type: "微信支付电子凭证", Transaction: order } },
    c = { id: "c", fields: parseReceipt(personal()).fields },
    d = {
      id: "d",
      fields: { Type: "微信支付转账电子凭证", Transaction: transferOrder },
    };
  assert.equal(peerMap([a, b, c, d]).size, 4);
  assert.ok(reasons(a, b).length);
  assert.ok(reasons(c, d).length);
  const other = {
      id: "e",
      fields: { ...a.fields, Transaction: order.slice(0, -1) + "1" },
    },
    alipay = { id: "f", fields: { ...a.fields, Type: "支付宝支付截图" } };
  assert.equal(peerMap([a, other, alipay]).size, 0);
  const collision = {
    id: "g",
    fields: { ...c.fields, PaymentKind: "扫码付款" },
  };
  assert.equal(peerMap([c, collision]).size, 0);
});
test("Excel keeps long orders as text, visible transfer recipient and refund in separate numeric column", async () => {
  const a = { id: "a", fields: parseReceipt(personal()).fields },
    b = {
      id: "b",
      fields: {
        ...a.fields,
        Amount: "241.00",
        RefundAmount: "118.00",
        RefundTime: "2026-10-07 16:00:00",
      },
    };
  const zip = await JSZip.loadAsync(
      await (await exportExcel([a, b])).arrayBuffer(),
    ),
    xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  for (const label of [
    "商品说明",
    "退款金额（元）",
    "退款时间",
    "收款时间",
    "支付类型",
  ])
    assert.ok(xml.includes(label));
  assert.ok(xml.includes("测试朋友"));
  assert.ok(!xml.includes("收款方已隐藏"));
  assert.match(xml, /<c r="D3" s="0" t="inlineStr"/);
  assert.match(xml, /<c r="M4" s="1"><v>118.00<\/v>/);
  assert.ok(xml.includes("4141.00"));
  assert.ok(xml.includes("A2:Q4"));
});
