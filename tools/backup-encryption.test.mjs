import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import JSZip from "jszip";
import { pbkdf2Sync, createHmac, createCipheriv } from "node:crypto";
import { ZipReader, BlobReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { decryptBackup, encryptBackup, isEncryptedBackup, validateBackupPassword } from "../src/backup-crypto.js";
import { pngBytes } from "./image-fixture.mjs";

const password = "Synthetic-backup-123!";
async function fixture(label) {
  globalThis.indexedDB = new IDBFactory();
  const s = await import("../src/storage.js?encrypted-" + label);
  const id = crypto.randomUUID();
  const row = { id, name:"合成保密凭证.png", photo:`photos/${id}.png`, hash:await s.hash(new Blob([pngBytes()])), raw:"secret synthetic text", warning:"", fields:{Type:"通用凭证", Amount:"12.00", Payee:"仅为合成测试"} };
  await s.save(row, new Blob([pngBytes()]));
  return {s,row};
}
test("password confirmation rejects short, excessive and mismatched values without trimming", () => {
  for (const p of [undefined,"", "a".repeat(11), "a".repeat(129)]) assert.throws(()=>validateBackupPassword(p));
  assert.throws(()=>validateBackupPassword(password,password+"x"),/不一致/);
  assert.equal(validateBackupPassword("  spaced password  "),"  spaced password  ");
});
test("AES ZIP hides receipt filenames and contents, uses AES-256 and randomized encryption", async () => {
  const {s,row} = await fixture("privacy");
  const a = await s.backup({password}), b = await s.backup({password});
  assert.equal(await isEncryptedBackup(a),true);
  const bytes = Buffer.from(await a.arrayBuffer());
  for (const text of ["receipts.json", row.photo, row.name, row.raw]) assert.equal(bytes.includes(Buffer.from(text)),false);
  assert.notDeepEqual(bytes,Buffer.from(await b.arrayBuffer()));
  const reader = new ZipReader(new BlobReader(a), {useWebWorkers:false});
  const [entry] = await reader.getEntries();
  assert.equal(entry.filename,"backup.zip"); assert.equal(entry.encrypted,true); assert.equal(entry.zipCrypto,false);
  // WinZip AES extra field: version AE-2, vendor AE, 256-bit strength.
  const central = bytes.indexOf(Buffer.from("504b0102","hex"));
  const extraAt = central+46+bytes.readUInt16LE(central+28);
  const extraEnd = extraAt+bytes.readUInt16LE(central+30);
  let aes;
  for(let at=extraAt;at+4<=extraEnd;at+=4+bytes.readUInt16LE(at+2)) if(bytes.readUInt16LE(at)===0x9901) aes=bytes.subarray(at+4,at+11);
  assert.ok(aes); assert.equal(aes.readUInt16LE(0),2); assert.equal(aes.subarray(2,4).toString(),"AE"); assert.equal(aes[4],3);
  await reader.close();
  // Independent WinZip AES reference verification using Node's native crypto.
  const at = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  const data = bytes.subarray(at, at + bytes.readUInt32LE(central + 20));
  const keys = pbkdf2Sync(password, data.subarray(0,16), 1000, 66, "sha1");
  assert.deepEqual(keys.subarray(64), data.subarray(16,18));
  const ciphertext = data.subarray(18,-10);
  assert.deepEqual(createHmac("sha1",keys.subarray(32,64)).update(ciphertext).digest().subarray(0,10),data.subarray(-10));
  const aesECB = createCipheriv("aes-256-ecb",keys.subarray(0,32),null);
  aesECB.setAutoPadding(false);
  const plain = Buffer.alloc(ciphertext.length);
  for(let offset=0,index=1;offset<plain.length;offset+=16,index++) {
    const counter=Buffer.alloc(16); counter.writeUInt32LE(index);
    const stream=aesECB.update(counter);
    for(let i=0;i<16 && offset+i<plain.length;i++) plain[offset+i]=ciphertext[offset+i]^stream[i];
  }
  const independentlyDecrypted = await JSZip.loadAsync(plain);
  assert.equal(JSON.parse(await independentlyDecrypted.file("receipts.json").async("string"))[0].name,row.name);
  const inner=await JSZip.loadAsync(await(await decryptBackup(a,password,500*1024*1024)).arrayBuffer());
  assert.equal(JSON.parse(await inner.file("receipts.json").async("string"))[0].name,row.name);
});
test("Unicode and spaced passwords round trip without normalization", async () => {
  for(const p of ["凭证备份-仅供测试-🔐2026", "  synthetic spaces  "]) {
    const file=await encryptBackup(new Blob(["fixture"]),p,1024*1024);
    assert.equal(await(await decryptBackup(file,p,1024*1024)).text(),"fixture");
    await assert.rejects(decryptBackup(file,p.trim()+"x",1024*1024),/密码/);
  }
});
test("missing/wrong passwords and authenticated ciphertext corruption preserve existing data", async () => {
  const {s} = await fixture("failures"), archive = await s.backup({password});
  const before = await s.records();
  for(const p of [undefined,"wrong"]) {
    await assert.rejects(s.restoreZIP(archive,{password:p}), /密码/);
    assert.deepEqual(await s.records(),before);
  }
  const tampered=Buffer.from(await archive.arrayBuffer());
  const dataAt=30+tampered.readUInt16LE(26)+tampered.readUInt16LE(28);
  tampered[dataAt+24]^=1;
  await assert.rejects(s.restoreZIP(tampered,{password}), /损坏|校验|signature|Signature/);
  assert.deepEqual(await s.records(),before);
});
test("encrypted and legacy backups restore with fresh revisions and exact photo bytes", async () => {
  const {s} = await fixture("roundtrip");
  for (const encrypted of [false,true]) {
    const safety = await s.backup({withSnapshot:true,...(encrypted?{password}:{})});
    assert.equal(await isEncryptedBackup(safety.blob),encrypted);
    const before = await s.records();
    assert.equal(await s.restoreZIP(safety.blob,{password,expectedSnapshot:safety.snapshot}),1);
    const after = await s.records();
    assert.notEqual(after[0].revision,before[0].revision);
    assert.deepEqual(after[0].fields,before[0].fields);
    assert.deepEqual(Buffer.from(await(await s.photo(after[0].id)).arrayBuffer()),pngBytes());
  }
});
test("encrypted restore retains concurrent-write protection and rejects oversize envelopes", async () => {
  const {s,row}=await fixture("concurrent"), safety=await s.backup({password,withSnapshot:true});
  await s.save({...row,fields:{...row.fields,Amount:"99.00"}});
  await assert.rejects(s.restoreZIP(safety.blob,{password,expectedSnapshot:safety.snapshot}),/其他页面修改/);
  assert.equal((await s.records())[0].fields.Amount,"99.00");
  await assert.rejects(decryptBackup(safety.blob,password,1),/超过/);
  await assert.rejects(encryptBackup(new Blob(["fixture"]),password,1),/超过/);
});
