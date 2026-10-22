import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { IDBFactory } from "fake-indexeddb";
import { inspectImage } from "../src/image-safety.js";
import { readZipEntry } from "../src/zip-safety.js";
import { prepareBackup, prepareBackupInWorker } from "../src/storage.js";
import { canvasFor } from "../src/ocr.js";
import { pngBytes } from "./image-fixture.mjs";

test("image sniffing rejects HTML/SVG and oversized dimensions before decoding", async () => {
  for (const text of ["<!doctype html><title>fixture</title>", '<svg xmlns="http://www.w3.org/2000/svg"/>'])
    await assert.rejects(inspectImage(new Blob([text], { type: "image/png" })), /无法验证/);
  const huge = pngBytes(); huge.writeUInt32BE(13000, 16);
  let decoded = false;
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => { decoded = true; };
  try { await assert.rejects(canvasFor(new Blob([huge])), /尺寸过大/); }
  finally { globalThis.createImageBitmap = previous; }
  assert.equal(decoded, false);
  assert.deepEqual(await inspectImage(new Blob([pngBytes()], { type: "text/html" })), { type: "image/png", width: 1, height: 1 });
});

test("JPEG, WebP, BMP and HEIC dimensions are parsed with bounds", async () => {
  const jpeg = Buffer.from([255,216,255,194,0,8,8,0,10,0,20,1]);
  const webp = Buffer.alloc(30); webp.write("RIFF"); webp.write("WEBP",8); webp.write("VP8X",12); webp[24] = 19; webp[27] = 9;
  const bmp = Buffer.alloc(54); bmp.write("BM"); bmp.writeUInt32LE(40,14); bmp.writeInt32LE(20,18); bmp.writeInt32LE(-10,22);
  const box = (name, data) => { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(name,4); data.copy(b,8); return b; };
  const ispe = Buffer.alloc(12); ispe.writeUInt32BE(20,4); ispe.writeUInt32BE(10,8);
  const heic = Buffer.concat([box("ftyp", Buffer.from("heic\0\0\0\0heic")), box("meta", Buffer.concat([Buffer.alloc(4),box("iprp",box("ipco",box("ispe",ispe)))]))]);
  for (const [bytes,type] of [[jpeg,"image/jpeg"],[webp,"image/webp"],[bmp,"image/bmp"],[heic,"image/heic"]])
    assert.deepEqual(await inspectImage(new Blob([bytes])), { type, width: 20, height: 10 });
  webp[20] = 2;
  await assert.rejects(inspectImage(new Blob([webp])), /动态图/);
  for (let n = 0; n < jpeg.length; n++) await assert.rejects(inspectImage(new Blob([jpeg.subarray(0,n)])));
});

test("entry reader stops accumulation on forged small sizes and retains CRC verification", async () => {
  const z = new JSZip(); z.file("receipts.json", "x".repeat(1024*1024));
  const bytes = await z.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
  const at = bytes.indexOf(Buffer.from("504b0102","hex")); bytes.writeUInt32LE(1,at+24);
  const parsed = await JSZip.loadAsync(bytes);
  await assert.rejects(readZipEntry(parsed.file("receipts.json"), 8*1024*1024), /大小不符/);
  const good = new JSZip(); good.file("receipts.json", "[]");
  for (const compression of ["STORE","DEFLATE"]) {
    const archive = await good.generateAsync({type:"nodebuffer",compression});
    const zip = await JSZip.loadAsync(archive);
    assert.equal(await (await readZipEntry(zip.file("receipts.json"), 8)).text(), "[]");
    const central = archive.indexOf(Buffer.from("504b0102","hex")); archive.writeUInt32LE(0,central+16);
    const corrupt = await JSZip.loadAsync(archive);
    await assert.rejects(readZipEntry(corrupt.file("receipts.json"),8), /CRC32/);
  }
});

test("unsupported entries are rejected before inflation; fake photos never reach a write transaction", async () => {
  const z = new JSZip(); z.file("receipts.json", "[]"); z.file("extra.bin", "x".repeat(1024*1024));
  await assert.rejects(prepareBackup(await z.generateAsync({type:"uint8array",compression:"DEFLATE"})), /未支持/);
  globalThis.indexedDB = new IDBFactory();
  const s = await import("../src/storage.js?security-fake-photo");
  const id = crypto.randomUUID(), path = `photos/${id}.png`, bytes = new Blob(["<!doctype html><title>inert</title>"]);
  const row = { id, photo:path, name:"fake.png", hash:await s.hash(bytes), raw:"", warning:"", fields:{Type:"通用凭证"} };
  await s.save({ ...row, id:"original" });
  const zip = new JSZip(); zip.file("receipts.json",JSON.stringify([row])); zip.file(path,await bytes.arrayBuffer());
  await assert.rejects(s.restoreZIP(await zip.generateAsync({type:"uint8array"})), /无法验证/);
  assert.equal((await s.records())[0].id,"original");
});

test("a stalled or failed backup worker is terminated without writing data", async () => {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  try {
    await assert.rejects(prepareBackupInWorker(new Blob(), 5), /超时/);
    assert.equal(workers[0].terminated,true);
    const error = prepareBackupInWorker(new Blob()); workers[1].onerror();
    await assert.rejects(error,/处理失败/); assert.equal(workers[1].terminated,true);
    const success = prepareBackupInWorker(new Blob()); workers[2].onmessage({data:{result:{prepared:[],blobs:[]}}});
    assert.deepEqual(await success,{prepared:[],blobs:[]}); assert.equal(workers[2].terminated,true);
  } finally { globalThis.Worker = previous; }
});
