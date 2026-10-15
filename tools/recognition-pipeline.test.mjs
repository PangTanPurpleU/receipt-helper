import test from "node:test";
import assert from "node:assert/strict";
import { recognize, dispose } from "../src/ocr.js";
const good = "4500000000202610151234567890";
const lines = (order) => [
  "账单",
  "合成测试商户",
  "-12.00",
  "当前状态 支付成功",
  "支付时间 2026年10月15日12:00:00",
  "商品 合成测试商品",
  "交易单号 " + order,
];
const items = (lines) =>
  lines.map((text, i) => ({
    text,
    poly: [
      [100, 100 + i * 120],
      [800, 100 + i * 120],
      [800, 130 + i * 120],
      [100, 130 + i * 120],
    ],
  }));
async function withEngine(responses, action) {
  const previous = {
    Worker: globalThis.Worker,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap,
  };
  let predictions = 0;
  globalThis.createImageBitmap = async () => ({
    width: 1000,
    height: 2000,
    close() {},
  });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      }),
    }),
  };
  globalThis.Worker = class {
    postMessage(data) {
      queueMicrotask(() => {
        const result =
          data.type === "init"
            ? { ready: true }
            : {
                result: {
                  items: items(
                    responses[Math.min(predictions++, responses.length - 1)],
                  ),
                },
              };
        this.onmessage({ data: { id: data.id, ...result } });
      });
    }
    terminate() {}
  };
  try {
    await action(() => predictions);
  } finally {
    await dispose();
    Object.assign(globalThis, previous);
  }
}
test("normal complete receipts only run one model prediction", () =>
  withEngine([lines(good)], async (count) => {
    const r = await recognize(new Blob());
    assert.equal(r.fields.Transaction, good);
    assert.equal(count(), 1);
    assert.equal(r.warning, "");
  }));
test("a successful anchored retry repairs the order and stops immediately", () =>
  withEngine([lines("45O000"), ["交易单号 " + good]], async (count) => {
    const r = await recognize(new Blob());
    assert.equal(r.fields.Transaction, good);
    assert.equal(count(), 2);
    assert.equal(r.fields.Amount, "12.00");
  }));
test("an unsuccessful targeted retry falls back once, and never loops on unreadable photos", () =>
  withEngine(
    [lines("45O000"), ["交易单号 ???"], ["交易单号 " + good]],
    async (count) => {
      const r = await recognize(new Blob());
      assert.equal(r.fields.Transaction, good);
      assert.equal(count(), 3);
    },
  ));
test("unreadable retry candidates remain flagged and are bounded", () =>
  withEngine([lines("45O000"), ["交易单号 ???"]], async (count) => {
    const r = await recognize(new Blob());
    assert.match(r.warning, /单号/);
    assert.equal(count(), 3);
  }));
test("synchronous worker send failure permits a fresh engine on the next attempt", async () => {
  const previous = globalThis.Worker;
  let count = 0;
  globalThis.Worker = class {
    constructor() {
      this.number = ++count;
    }
    postMessage(data) {
      if (this.number === 1) throw new Error("message transfer failed");
      queueMicrotask(() => this.onmessage({ data: { id: data.id } }));
    }
    terminate() {}
  };
  try {
    const { initialize } = await import("../src/ocr.js");
    await assert.rejects(initialize(), /message transfer failed/);
    await initialize();
    assert.equal(count, 2);
  } finally {
    await dispose();
    globalThis.Worker = previous;
  }
});

test("blank photos fail with a useful message after one broad retry", () =>
  withEngine([[]], async (count) => {
    await assert.rejects(recognize(new Blob()), /未识别到文字/);
    assert.equal(count(), 2);
  }));
test("a blank first pass can recover a complete screenshot and its correct type", () =>
  withEngine([[], lines(good)], async (count) => {
    const r = await recognize(new Blob());
    assert.equal(r.fields.Type, "微信支付截图");
    assert.equal(r.fields.Transaction, good);
    assert.equal(r.warning, "");
    assert.equal(count(), 2);
  }));

test("a new receipt layout is extracted in one pass without requiring a provider-specific order", () =>
  withEngine(
    [["星河便利店", "日期 2026年10月15日", "商品名称 矿泉水", "合计 6.50"]],
    async (count) => {
      const r = await recognize(new Blob());
      assert.equal(r.fields.Type, "通用凭证");
      assert.equal(r.fields.Amount, "6.50");
      assert.equal(r.fields.Traded, "2026-10-15");
      assert.equal(r.warning, "");
      assert.equal(count(), 1);
    },
  ));
test("adaptive retry fills evidence-backed fields and retains valid original values", () =>
  withEngine(
    [["星河便利店", "日期 2026年10月15日", "金额 ???"], ["实付金额 6.50"]],
    async (count) => {
      const r = await recognize(new Blob());
      assert.equal(r.fields.Type, "通用凭证");
      assert.equal(r.fields.Amount, "6.50");
      assert.equal(r.fields.Payee, "星河便利店");
      assert.equal(r.warning, "");
      assert.equal(count(), 2);
    },
  ));
