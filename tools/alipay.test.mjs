import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  parseReceipt,
  needsRecognitionRetry,
  receiptFieldDefs,
  peerMap,
  summary,
} from "../src/core.js";
import { validReceiptOrder } from "../src/receipt-types.js";
import { exportExcel } from "../src/excel.js";
// Fictional fixtures only. Private acceptance screenshots stay outside Git.
const order = "2026101523001449101234567890";
const fixture = (extra = [], head = "测试星云商店", amount = "-1,258.85") => [
  "11:03 电量74",
  "账单详情",
  "测试图标",
  head,
  amount,
  "交易成功",
  "支付时间 2026-10-15 10:12:34",
  "付款方式 测试银行卡(0000)>",
  ...extra,
  "订单号 " + order,
  "商家订单号 商家可扫码退款或查询交易",
  "账单管理",
  "账单分类 餐饮美食",
];
test("headline actual payment wins over discount and gross amount; payment time wins over ride time", () => {
  const r = parseReceipt(
    fixture([
      "订单金额 1481.00",
      "焕新折扣 -222.15",
      "乘车时间 2026-10-15 09:00:00",
    ]),
  );
  assert.equal(r.fields.Type, "支付宝支付截图");
  assert.equal(r.fields.Amount, "1258.85");
  assert.equal(r.fields.Traded, "2026-10-15 10:12:34");
  assert.equal(r.fields.Transaction, order);
  assert.equal(r.fields.OrderAmount, "1481.00");
  assert.equal(r.fields.RideTime, "2026-10-1509:00:00");
  assert.equal(r.fields.MerchantOrder, "");
  assert.equal(r.warning, "");
  assert.equal(needsRecognitionRetry(r), false);
});
test("full recipient is preferred; masked names remain masked; full recipient never comes from acquiring or clearing bank", () => {
  const r = parseReceipt(
    fixture(
      [
        "收单机构 测试收单机构",
        "清算机构 测试清算机构",
        "收款方全称 测试星云有限公司(分店)",
      ],
      "星云**店",
    ),
  );
  assert.equal(r.fields.Payee, "测试星云有限公司(分店)");
  assert.equal(r.fields.PayeeDisplayName, "星云**店");
  assert.equal(parseReceipt(fixture([], "发**")).fields.Payee, "发**");
  assert.equal(
    parseReceipt(fixture([], "**甲(个人)")).fields.Payee,
    "**甲(个人)",
  );
  assert.equal(
    parseReceipt(fixture(["收单机构 测试收单机构"])).fields.Payee,
    "测试星云商店",
  );
});
test("missing headline is left for review, never substituted with a discount or labelled order amount", () => {
  const lines = fixture(["订单金额 100.00", "优惠金额", "-20.00"]);
  lines.splice(lines.indexOf("-1,258.85"), 1);
  const r = parseReceipt(lines);
  assert.equal(r.fields.Amount, "");
  assert.match(r.warning, /金额未识别/);
  assert.equal(needsRecognitionRetry(r), true);
});
test("split order and datetime rows join without borrowing merchant order or phone time", () => {
  const lines = fixture().filter(
    (s) => !s.startsWith("订单号") && !s.startsWith("支付时间"),
  );
  lines.splice(
    6,
    0,
    "支付时间",
    "2026–10–15 10:12:34",
    "订单号",
    "20261015230014",
    "49101234567890",
    "商家订单号 T200TEST12345678",
  );
  const r = parseReceipt(lines);
  assert.equal(r.fields.Transaction, order);
  assert.equal(r.fields.Traded, "2026-10-15 10:12:34");
  assert.equal(r.fields.MerchantOrder, "T200TEST12345678");
});
test("different order lengths are valid without numeric character substitution; non-success states stay reviewable", () => {
  const f = parseReceipt(fixture()).fields;
  assert.equal(
    validReceiptOrder({ ...f, Transaction: "20261015230014491012345678901" }),
    true,
  );
  assert.equal(
    validReceiptOrder({ ...f, Transaction: "20261015230014491O1234567890" }),
    false,
  );
  assert.match(
    parseReceipt(fixture().map((s) => (s === "交易成功" ? "交易关闭" : s)))
      .warning,
    /支付状态/,
  );
  const cropped = fixture().filter((s) => s !== "账单详情");
  assert.equal(
    parseReceipt(cropped, null, "支付宝支付截图").fields.Type,
    "支付宝支付截图",
  );
});
test("screenshots do not require nonexistent payer or uppercase amount; details expose payment fields", () => {
  const r = parseReceipt(fixture());
  assert.equal(r.warning, "");
  assert.equal(needsRecognitionRetry(r), false);
  assert.deepEqual(
    receiptFieldDefs(r.fields)
      .slice(0, 4)
      .map(([key]) => key),
    ["Traded", "Amount", "Payee", "Transaction"],
  );
  assert.ok(
    !receiptFieldDefs(r.fields).some(
      ([key]) => key === "Payer" || key === "AmountChinese",
    ),
  );
  const invalid = { ...r, fields: { ...r.fields, Transaction: "" } };
  assert.equal(needsRecognitionRetry(invalid), true);
});
test("duplicate order is platform scoped; masked recipient or same amount/time never merges different orders", () => {
  const a = { id: "a", fields: parseReceipt(fixture([], "测试**店")).fields },
    same = { id: "b", fields: { ...a.fields } },
    different = {
      id: "c",
      fields: { ...a.fields, Transaction: "2026101523001449101234567891" },
    },
    wechat = { id: "d", fields: { ...a.fields, Type: "微信支付电子凭证" } };
  assert.equal(peerMap([a, same]).size, 2);
  assert.equal(peerMap([a, different, wechat]).size, 0);
  assert.equal(
    peerMap([
      a,
      { ...different, hash: "bytes" },
      { ...wechat, id: "e", hash: "bytes" },
    ]).size,
    2,
  );
  assert.equal(summary([a, same]).value, "2517.70");
});
test("screenshot and mixed Excel exports use adaptable columns, exact text orders and real amount totals", async () => {
  const a = { id: "a", fields: parseReceipt(fixture()).fields },
    b = { id: "b", fields: { ...a.fields } };
  const blob = await exportExcel([a, b]),
    z = await JSZip.loadAsync(await blob.arrayBuffer()),
    xml = await z.file("xl/worksheets/sheet1.xml").async("string");
  for (const label of [
    "支付时间",
    "支付金额（元）",
    "订单号",
    "商户显示名称",
    "商家订单号",
    "付款方式",
  ])
    assert.ok(xml.includes(label));
  assert.match(xml, /<c r="D3" s="0" t="inlineStr"/);
  assert.match(xml, /<c r="I3" s="3"/);
  assert.ok(xml.includes("2517.70"));
  assert.ok(xml.includes("A2:I4"));
  assert.ok(!xml.includes("金额大写"));
  const mixed = await exportExcel([
      a,
      { ...b, id: "w", fields: { ...a.fields, Type: "微信支付电子凭证" } },
    ]),
    mz = await JSZip.loadAsync(await mixed.arrayBuffer());
  assert.ok(
    (await mz.file("xl/worksheets/sheet1.xml").async("string")).includes(
      "支付/交易时间",
    ),
  );
});

test("bank discount label split across OCR rows remains supplementary information", () => {
  const r = parseReceipt(
    fixture(["订单金额 1260.93", "工商银行立减 -2.08", "金"]),
  );
  assert.ok(r.fields.Discount.includes("-2.08"));
  assert.equal(r.fields.Amount, "1258.85");
});

test("generic bill details without Alipay evidence are not automatically labelled Alipay", () => {
  const r = parseReceipt([
    "账单详情",
    "测试收款人",
    "-12.00",
    "交易成功",
    "支付时间 2026-10-15 10:12:34",
    "订单号 " + order,
  ]);
  assert.notEqual(r.fields.Type, "支付宝支付截图");
});
