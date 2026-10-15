import test from "node:test";
import assert from "node:assert/strict";
import { peerMap, receiptFieldDefs } from "../src/core.js";
test("manual equivalent amount formats share duplicate evidence without merging different complete orders", () => {
  const f = {
    Type: "微信支付电子凭证",
    Transaction: "",
    Amount: "12.00",
    Traded: "2026-10-15 12:00:00",
    Payer: "测试甲",
    Payee: "测试商户",
  };
  assert.equal(
    peerMap([
      { id: "a", fields: f },
      { id: "b", fields: { ...f, Amount: "12" } },
    ]).size,
    2,
  );
  assert.equal(
    peerMap([
      {
        id: "a",
        fields: { ...f, Transaction: "4500000000202610151234567890" },
      },
      {
        id: "b",
        fields: {
          ...f,
          Amount: "12",
          Transaction: "4500000000202610151234567891",
        },
      },
    ]).size,
    0,
  );
});
test("missing product descriptions and notes remain editable on both screenshot types", () => {
  for (const Type of ["微信支付截图", "支付宝支付截图"]) {
    const keys = receiptFieldDefs({ Type }).map(([k]) => k);
    assert.ok(keys.includes("ProductDescription"));
    assert.ok(keys.includes("Note"));
    assert.ok(!keys.includes("Payer"));
  }
});
