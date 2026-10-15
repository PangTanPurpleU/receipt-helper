import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import JSZip from "jszip";
import { exportExcel } from "../src/excel.js";

async function setup(name) {
  globalThis.indexedDB = new IDBFactory();
  return import("../src/storage.js?release-" + name);
}
async function fixture(s, overrides = {}) {
  const id = crypto.randomUUID(), bytes = new Uint8Array([1, 2, 3]);
  return {
    id, name: "合成凭证.png", photo: `photos/${id}.png`,
    hash: await s.hash(new Blob([bytes])), raw: "合成测试", warning: "",
    fields: { Type: "支付宝支付截图", Amount: "12.00", Payee: "合成商户", Traded: "2026-10-15 12:00:00", Transaction: "202610150000000000000001", TradeStatus: "交易成功", ProductDescription: "合成商品XYZ" },
    ...overrides,
  };
}
const bytes = () => new Uint8Array([1, 2, 3]);

test("Alipay product is exported both alone and with other receipt types", async () => {
  const s = await setup("excel"), row = await fixture(s);
  for (const Type of [null, "微信支付截图", "通用凭证", "微信支付电子凭证"]) {
    const rows = Type ? [row, { ...row, id: "second", fields: { ...row.fields, Type } }] : [row];
    const z = await JSZip.loadAsync(await (await exportExcel(rows)).arrayBuffer());
    const xml = await z.file("xl/worksheets/sheet1.xml").async("string");
    assert.match(xml, /商品说明/);
    assert.match(xml, /合成商品XYZ/);
    // A3..lastColumn3 must match the exported header count, without duplicate cell refs.
    const headers = [...xml.match(/<row r="2"[^>]*>(.*?)<\/row>/)[1].matchAll(/<c r="([A-Z]+)2"/g)];
    const cells = [...xml.match(/<row r="3"[^>]*>(.*?)<\/row>/)[1].matchAll(/<c r="([A-Z]+)3"/g)];
    assert.deepEqual(cells.map(m => m[1]), headers.map(m => m[1]));
  }
});

test("restore rejects insert, edit and delete after the safety backup and keeps current data", async () => {
  for (const kind of ["insert", "edit", "delete"]) {
    const s = await setup(kind), row = await fixture(s);
    await s.save(row, bytes());
    const safety = await s.backup({ withSnapshot: true });
    if (kind === "insert") await s.save(await fixture(s), bytes());
    if (kind === "edit") await s.save({ ...row, fields: { ...row.fields, Amount: "99.00" } });
    if (kind === "delete") await s.remove([row.id]);
    const before = await s.records();
    await assert.rejects(s.restoreZIP(await safety.blob.arrayBuffer(), { expectedSnapshot: safety.snapshot }), /其他页面修改/);
    assert.deepEqual(await s.records(), before);
    assert.deepEqual([...(await s.photo(row.id))], [...bytes()]);
  }
});

test("empty safety snapshot also protects concurrent imports", async () => {
  const s = await setup("empty"), safety = await s.backup({ withSnapshot: true });
  const row = await fixture(s);
  await s.save(row, bytes());
  await assert.rejects(s.restoreZIP(await safety.blob.arrayBuffer(), { expectedSnapshot: safety.snapshot }), /其他页面修改/);
  assert.equal((await s.records()).length, 1);
});

test("unchanged safety snapshot restores successfully with fresh revisions", async () => {
  const s = await setup("roundtrip"), row = await fixture(s);
  await s.save(row, bytes());
  const safety = await s.backup({ withSnapshot: true }), old = (await s.records())[0];
  assert.equal(await s.restoreZIP(await safety.blob.arrayBuffer(), { expectedSnapshot: safety.snapshot }), 1);
  const restored = (await s.records())[0];
  assert.deepEqual(restored.fields, row.fields);
  assert.notEqual(restored.revision, old.revision);
});

test("backup rejects records JSON that the restore limit would reject", async () => {
  const s = await setup("large-json"), row = await fixture(s, { raw: "x".repeat(8 * 1024 * 1024) });
  await s.save(row, bytes());
  await assert.rejects(s.backup(), /备份记录文件过大/);
  assert.equal((await s.records()).length, 1);
});

test("backup rejects too many records and invalid fields before producing a success blob", async () => {
  const s = await setup("invalid"), row = await fixture(s);
  await s.save({ ...row, fields: { ...row.fields, ProductDescription: "x".repeat(32761) } }, bytes());
  await assert.rejects(s.backup(), /无效/);
  const db = await s.openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("receipts", "readwrite");
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    const store = tx.objectStore("receipts");
    store.clear();
    for (let i = 0; i < 5001; i++) store.put({ ...row, id: String(i) });
  });
  await assert.rejects(s.backup(), /5000/);
});

test("corrupt archived photos cannot produce a misleading backup", async () => {
  const s = await setup("bad-photo"), row = await fixture(s);
  await s.save(row, new Uint8Array([4, 5, 6]));
  await assert.rejects(s.backup(), /照片校验失败/);
});
