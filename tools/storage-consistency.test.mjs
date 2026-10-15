import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import JSZip from "jszip";

async function setup(name) {
  globalThis.indexedDB = new IDBFactory();
  return import("../src/storage.js?" + name);
}
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "测试.png",
  photo: "photos/00000000-0000-4000-8000-000000000001.png",
  raw: "synthetic",
  warning: "",
  hash: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  fields: { Amount: "12.00" },
};
test("simultaneous startup reads share one database connection", async () => {
  const s = await setup("opening");
  const [a, b] = await Promise.all([s.openDB(), s.openDB()]);
  assert.equal(a, b);
});
test("concurrent editors cannot overwrite a newer revision or recreate a deleted row", async () => {
  const s = await setup("concurrent");
  await s.save(row);
  const original = (await s.records())[0];
  await s.save({ ...original, fields: { Amount: "13.00" } }, undefined, {
    expectedRevision: original.revision,
  });
  await assert.rejects(
    s.save({ ...original, fields: { Amount: "14.00" } }, undefined, {
      expectedRevision: original.revision,
    }),
    /其他页面/,
  );
  assert.equal((await s.records())[0].fields.Amount, "13.00");
  await s.remove([original.id]);
  await assert.rejects(
    s.save(original, undefined, { expectedRevision: original.revision }),
    /其他页面/,
  );
  assert.equal((await s.records()).length, 0);
});
test("legacy rows without a revision can be edited once with optimistic protection", async () => {
  const s = await setup("legacy"),
    db = await s.openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction("receipts", "readwrite");
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.objectStore("receipts").put(row);
  });
  await s.save({ ...row, fields: { Amount: "15.00" } }, undefined, {
    expectedRevision: null,
  });
  await assert.rejects(
    s.save(row, undefined, { expectedRevision: null }),
    /其他页面/,
  );
  assert.equal((await s.records())[0].fields.Amount, "15.00");
});
test("backup snapshots photos and rows atomically before a competing writer", async () => {
  const s = await setup("snapshot");
  await s.save(row, new Uint8Array([1, 2, 3]));
  const pending = s.backup();
  await s.save(
    { ...row, fields: { Amount: "20.00" } },
    new Uint8Array([4, 5, 6]),
  );
  const z = await JSZip.loadAsync(await (await pending).arrayBuffer());
  const saved = JSON.parse(await z.file("receipts.json").async("string"));
  assert.equal(saved[0].fields.Amount, "12.00");
  assert.deepEqual(
    [...(await z.file(row.photo).async("uint8array"))],
    [1, 2, 3],
  );
  assert.equal((await s.records())[0].fields.Amount, "20.00");
});
test("missing archived photo prevents an apparently successful incomplete backup", async () => {
  const s = await setup("missing");
  await s.save(row);
  await assert.rejects(s.backup(), /存档照片缺失/);
});
