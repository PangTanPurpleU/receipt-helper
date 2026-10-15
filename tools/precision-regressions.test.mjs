import test from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "../src/money.js";
import {
  parseReceipt,
  needsRecognitionRetry,
  peerMap,
  summary,
} from "../src/core.js";
import { mergeRecognition, retryRegion } from "../src/recognition-retry.js";
import { normalizeEditedFields, formatTotal } from "../src/ui-utils.js";

const fields = {
  Type: "微信支付电子凭证",
  Transaction: "1234567890123456789012345678",
  Amount: "12.00",
  Payee: "测试商户",
  Payer: "测试人",
  Traded: "2026-10-15 12:00:00",
};
test("large aggregate totals preserve every cent and export as exact text beyond Excel precision", async () => {
  const rows = [
    { id: "a", fields: { Amount: "90071992547409.91" } },
    { id: "b", fields: { Amount: "0.02" } },
  ];
  const result = summary(rows);
  assert.equal(result.value, "90071992547409.93");
  assert.equal(result.cents, null);
  assert.equal(formatTotal(result.value), "90,071,992,547,409.93");
  const { exportExcel } = await import("../src/excel.js"),
    { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(
    await (await exportExcel(rows)).arrayBuffer(),
  );
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(xml, /<c r="B1"[^>]*t="inlineStr"[^>]*>.*?90071992547409\.93/);
  assert.match(xml, /<c r="B3"[^>]*t="inlineStr"[^>]*>.*?90071992547409\.91/);
});
test("manual copy and paste normalizes structured fields while preserving merchant letters and free text", () => {
  const input = {
    Amount: " ￥１,２３４.５０ ",
    Transaction: "１２３４ ５６７８",
    MerchantOrder: "13L0012",
    Traded: " 2026-10-15 12:00:00 ",
    Note: "keep spaces  here",
  };
  assert.deepEqual(normalizeEditedFields(input), {
    ...input,
    Amount: "1234.50",
    Transaction: "12345678",
    Traded: "2026-10-15 12:00:00",
  });
  assert.equal(normalizeEditedFields({ Amount: "12.345" }).Amount, "12.345");
  assert.equal(input.Transaction, "１２３４ ５６７８");
});
test("certificate amounts preserve thousands, cents and legitimate OCR decimal repairs", () => {
  for (const [input, expected] of [
    ["1,234.56", "1234.56"],
    ["1,234", "1234.00"],
    ["12,34", "12.34"],
    ["12、34", "12.34"],
    ["１２３４．５６", "1234.56"],
    ["¥1,234.50元", "1234.50"],
  ])
    assert.equal(
      parseReceipt(["微信支付电子凭证", "小写：" + input]).fields.Amount,
      expected,
    );
});
test("unreadable amounts never silently become their numeric suffix", () => {
  for (const input of [
    "12.345",
    "1.234.56",
    "abc12.00",
    "12O.00",
    "-12.00",
    "1,23,456.00",
  ])
    assert.equal(
      parseReceipt(["微信支付电子凭证", "小写：" + input]).fields.Amount,
      "",
      input,
    );
  assert.equal(parseMoney("90071992547409.92"), "");
  assert.equal(
    parseReceipt(["实付金额：12,34", "商户名称：测试店"]).fields.Amount,
    undefined,
  );
});
test("uppercase conflict triggers a bounded retry and is repaired only by corroborated amount", () => {
  const first = parseReceipt([], {
    ...fields,
    Amount: "72.00",
    AmountChinese: "壹拾贰元整",
  });
  assert.equal(needsRecognitionRetry(first), true);
  assert.ok(retryRegion([], first.fields, 1000, 2000));
  const repaired = mergeRecognition(first, { fields: { Amount: "12.00" } });
  assert.equal(repaired.fields.Amount, "12.00");
  assert.equal(repaired.warning, "");
  assert.equal(needsRecognitionRetry(repaired), false);
  assert.equal(
    mergeRecognition(first, { fields: { Amount: "52.00" } }).fields.Amount,
    "72.00",
  );
  assert.equal(
    parseReceipt([], { ...fields, Amount: "12", AmountChinese: "壹拾贰元整" })
      .warning,
    "",
  );
});
test("retry never mixes fields from different complete transaction numbers", () => {
  const first = parseReceipt([], { ...fields, Payee: "" });
  assert.deepEqual(
    mergeRecognition(first, {
      fields: { ...fields, Transaction: "2234567890123456789012345678" },
    }),
    first,
  );
  assert.equal(mergeRecognition(first, { fields }).fields.Payee, "测试商户");
});
test("masked party names cannot identify a transaction from amount and time alone", () => {
  for (const change of [
    { Payer: "张*" },
    { Payee: "李＊" },
    { Payer: "张…" },
  ]) {
    const f = { ...fields, Transaction: "", ...change };
    assert.equal(
      peerMap([
        { id: "a", fields: f },
        { id: "b", fields: f },
      ]).size,
      0,
    );
    assert.equal(
      peerMap([
        { id: "a", hash: "same", fields: f },
        { id: "b", hash: "same", fields: f },
      ]).size,
      2,
    );
  }
});
test("conflicting complete orders override a shared certificate number", () => {
  const f = { ...fields, Certificate: "same-certificate" };
  assert.equal(
    peerMap([
      { id: "a", fields: f },
      {
        id: "b",
        fields: { ...f, Transaction: "2234567890123456789012345678" },
      },
    ]).size,
    0,
  );
});
