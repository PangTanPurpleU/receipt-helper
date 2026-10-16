import test from "node:test";
import assert from "node:assert/strict";
import { parseReceipt, peerMap } from "../src/core.js";
import { mergeRecognition } from "../src/recognition-retry.js";
import { normalizeEditedFields } from "../src/ui-utils.js";

test("empty generic labels never consume the next compact label/value row", () => {
  for (const next of ["实付金额12.00", "交易日期2026-10-16", "订单号12345678"]) {
    const r = parseReceipt(["商户名称", next, "日期：2026-10-16"]);
    assert.equal(r.fields.Payee, undefined, next);
    assert.match(r.warning, /收款方/);
  }
  const r = parseReceipt(["商户名称", "测试商店", "实付金额12.00", "交易日期2026-10-16"]);
  assert.equal(r.fields.Payee, "测试商店");
  assert.equal(r.fields.Amount, "12.00");
  assert.equal(r.warning, "");
});

test("generic amount labels cannot borrow another compact total or partial amount", () => {
  for (const next of ["合计100.00", "退款金额10.00", "优惠20.00", "数量2"]) {
    const r = parseReceipt(["实付金额", next, "商户名称 测试商店", "日期2026-10-16"]);
    assert.equal(r.fields.Amount, undefined, next);
  }
});

test("Alipay payee and product stop before discount labels", () => {
  const base = ["账单详情", "测试商店", "-12.00", "交易成功", "支付时间 2026-10-16 12:00:00", "订单号 202610160000000000000001", "商家订单号 TEST00001"];
  for (const discount of ["优惠金额 -1.00", "焕新折扣 -1.00", "工商银行立减金 -1.00", "碰一下立减 -1.00"]) {
    const r = parseReceipt([...base.slice(0, 4), "收款方全称 测试有限公司", discount, "商品说明 测试商品", discount, ...base.slice(4)]);
    assert.equal(r.fields.Payee, "测试有限公司");
    assert.equal(r.fields.ProductDescription, "测试商品");
    assert.equal(r.fields.Amount, "12.00");
  }
});

test("generic retries never mix two complete identifiers even when date or amount is missing", () => {
  const fields = {Type:"通用凭证",Transaction:"ABC12345",Payee:"",Traded:"2026-10-16"};
  const first = parseReceipt([], fields);
  const other = parseReceipt([], {...fields,Transaction:"XYZ12345",Payee:"另一商户",Amount:"12.00",Traded:"2026-10-16 12:00:00"});
  assert.deepEqual(mergeRecognition(first,other),first);
  assert.equal(mergeRecognition(first, {...other,fields:{...other.fields,Transaction:"ABC12345"}}).fields.Payee,"另一商户");
});

test("equivalent generic amount and party spelling still matches a precise complete order", () => {
  const fields = {Type:"通用凭证",Transaction:"ABC12345",Payee:"测试商店",Source:"测试银行",Amount:"12.00",Traded:"2026-10-16 12:00:00"};
  const a={id:"a",fields};
  assert.equal(peerMap([a,{id:"b",fields:{...fields,Amount:"12",Payee:" 测试商店 ",Source:" 测试银行 "}}]).size,2);
  for (const change of [{Amount:"13.00"},{Payee:"另一商店"},{Traded:"2026-10-16"},{Source:"另一银行"}])
    assert.equal(peerMap([a,{id:"b",fields:{...fields,...change}}]).size,0);
});

test("refund and gross amounts receive the same paste normalization as paid amount", () => {
  const input={Amount:"￥１２．００",RefundAmount:" ￥１,２３４.５０ ",OrderAmount:"￥１,２４６.５０",Note:" 原文 保留 "};
  assert.deepEqual(normalizeEditedFields(input),{...input,Amount:"12.00",RefundAmount:"1234.50",OrderAmount:"1246.50"});
  assert.equal(normalizeEditedFields({RefundAmount:"12.345"}).RefundAmount,"12.345");
});

test("missing payment status remains editable and refund details expose both companion fields", async () => {
  const { receiptFieldDefs } = await import("../src/core.js");
  for (const Type of ["微信支付截图", "支付宝支付截图"])
    assert.ok(receiptFieldDefs({Type}).some(([key]) => key === "TradeStatus"));
  for (const change of [{TradeStatus:"已退款"},{RefundAmount:"2.00"},{RefundTime:"2026-10-16 12:00:00"}]) {
    const keys=receiptFieldDefs({Type:"微信支付截图",...change}).map(([key])=>key);
    assert.ok(keys.includes("RefundAmount"));
    assert.ok(keys.includes("RefundTime"));
  }
});

test("out-of-range generic amounts never turn their order into duplicate evidence", () => {
  const fields={Type:"通用凭证",Payee:"测试商店",Transaction:"ORDER12345",Amount:"99999999999999999.00",Traded:"2026-10-16 12:00:00"};
  assert.equal(peerMap([{id:"a",fields},{id:"b",fields}]).size,0);
});

test("a slower previous database read cannot replace a newer foreground snapshot", async () => {
  const { createLatestRefresh } = await import("../src/ui-utils.js");
  const reads = [], applied = [];
  const refresh = createLatestRefresh(() => new Promise(resolve => reads.push(resolve)), rows => applied.push(rows));
  const first = refresh(), second = refresh();
  reads[1]([{Amount:"99.00"}]);
  await second;
  reads[0]([{Amount:"12.00"}]);
  await first;
  assert.deepEqual(applied, [[{Amount:"99.00"}]]);
});

test("failed foreground reads preserve the displayed data and allow retry", async () => {
  const { createLatestRefresh } = await import("../src/ui-utils.js");
  let failing = true, displayed = "existing";
  const refresh = createLatestRefresh(async () => {
    if (failing) throw Error("database unavailable");
    return "latest";
  }, data => { displayed = data; });
  await assert.rejects(refresh(), /database unavailable/);
  assert.equal(displayed, "existing");
  failing = false;
  await refresh();
  assert.equal(displayed, "latest");
});
