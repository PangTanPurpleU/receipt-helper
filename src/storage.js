import JSZip from "jszip";
import { parseReceipt } from "./core.js";
// Keep legacy stores inert so an application update never purges previously stored data.
let db, opening;
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function openDB() {
  if (db) return db;
  if (opening) return opening;
  const operation = new Promise((resolve, reject) => {
    const r = indexedDB.open("receipt-helper-local", 2);
    let blocked = false;
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("receipts"))
        d.createObjectStore("receipts", { keyPath: "id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos");
      if (!d.objectStoreNames.contains("trash"))
        d.createObjectStore("trash", { keyPath: "id" });
      if (!d.objectStoreNames.contains("recovery"))
        d.createObjectStore("recovery");
    };
    r.onsuccess = () => {
      const connection = r.result;
      if (blocked) {
        connection.close();
        return;
      }
      db = connection;
      connection.onversionchange = () => {
        connection.close();
        if (db === connection) db = null;
      };
      connection.onclose = () => {
        if (db === connection) db = null;
      };
      resolve(connection);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => {
      blocked = true;
      reject(new Error("请关闭其他打开此网站的标签页后重试"));
    };
  });
  opening = operation;
  try {
    return await operation;
  } finally {
    if (opening === operation) opening = null;
  }
}
const done = (t) =>
  new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("保存已取消"));
  });
export async function records() {
  const d = await openDB();
  return request(d.transaction("receipts").objectStore("receipts").getAll());
}
export async function photo(id) {
  const d = await openDB();
  return request(d.transaction("photos").objectStore("photos").get(id));
}
function announceChange() {
  if (typeof window !== "undefined" && typeof BroadcastChannel === "function") {
    const channel = new BroadcastChannel("receipt-helper-changes");
    channel.postMessage("changed");
    channel.close();
  }
}
export async function save(row, blob, { expectedRevision } = {}) {
  const d = await openDB(),
    t = d.transaction(
      blob ? ["receipts", "photos"] : ["receipts"],
      "readwrite",
    ),
    complete = done(t);
  let writeError;
  const write = () => {
    try {
      t.objectStore("receipts").put({ ...row, revision: crypto.randomUUID() });
      if (blob) t.objectStore("photos").put(blob, row.id);
    } catch (error) {
      writeError = error;
      t.abort();
    }
  };
  try {
    if (expectedRevision === undefined) write();
    else {
      const lookup = t.objectStore("receipts").get(row.id);
      lookup.onsuccess = () => {
        if (
          !lookup.result ||
          (lookup.result.revision ?? null) !== expectedRevision
        ) {
          writeError = new Error(
            "这张凭证已在其他页面修改或删除，请关闭详情并重新打开后核对",
          );
          t.abort();
        } else write();
      };
    }
  } catch (error) {
    writeError = error;
    t.abort();
  }
  try {
    await complete;
  } catch (error) {
    throw writeError || error;
  }
  announceChange();
}
export async function remove(ids) {
  const d = await openDB(),
    wanted = new Set(ids),
    t = d.transaction(["receipts"], "readwrite"),
    complete = done(t);
  let count = 0;
  const lookup = t.objectStore("receipts").getAll();
  lookup.onsuccess = () => {
    for (const r of lookup.result)
      if (wanted.has(r.id)) {
        t.objectStore("receipts").delete(r.id);
        count++;
      }
  };
  await complete;
  announceChange();
  return count;
}
export async function hash(blob) {
  const a = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(a), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export const BACKUP_LIMITS = Object.freeze({
  bytes: 500 * 1024 * 1024,
  jsonBytes: 8 * 1024 * 1024,
  photoBytes: 100 * 1024 * 1024,
  records: 5000,
});
// Include full records as well as revisions so legacy writers are detected too.
const snapshotOf = (rows) => JSON.stringify(rows);
function validateBackupRow(r, ids, paths) {
  if (
    !r ||
    typeof r !== "object" ||
    !/^[0-9a-f-]{36}$/i.test(r.id) ||
    ids.has(r.id) ||
    !/^photos\/[0-9a-f-]{36}\.(jpg|jpeg|png|bmp|heic)$/i.test(r.photo) ||
    paths.has(r.photo) ||
    !r.fields ||
    typeof r.fields !== "object" ||
    Array.isArray(r.fields) ||
    Object.keys(r.fields).length > 128 ||
    Object.values(r.fields).some(
      (v) => typeof v !== "string" || v.length > 32760,
    ) ||
    !/^[a-f0-9]{64}$/i.test(r.hash) ||
    typeof r.name !== "string" ||
    r.name.length > 1024 ||
    typeof r.raw !== "string" ||
    typeof r.warning !== "string" ||
    (r.imported !== undefined && typeof r.imported !== "string")
  )
    throw new Error("备份中有无效或重复记录");
}
function checkArchiveLimits(z, archiveBytes) {
  const limit = BACKUP_LIMITS.bytes;
  if (archiveBytes > limit) throw new Error("备份超过 500 MB");
  const entries = Object.values(z.files).filter((e) => !e.dir);
  if (entries.length > BACKUP_LIMITS.records + 1)
    throw new Error("备份文件数量过多");
  let size = 0;
  for (const entry of entries) {
    const bytes = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("备份文件大小无效");
    size += bytes;
    if (size > limit) throw new Error("备份解压后过大");
    if (
      bytes >
      (entry.name === "receipts.json"
        ? BACKUP_LIMITS.jsonBytes
        : BACKUP_LIMITS.photoBytes)
    )
      throw new Error(
        entry.name === "receipts.json" ? "备份记录文件过大" : "备份照片过大",
      );
  }
}
export async function backup({ withSnapshot = false } = {}) {
  const d = await openDB(),
    t = d.transaction(["receipts", "photos"], "readonly"),
    complete = done(t),
    photos = new Map();
  let rows = [];
  // Queue photo reads from the getAll success callback while the transaction
  // is active. All records/photos belong to the same database snapshot.
  const lookup = t.objectStore("receipts").getAll();
  lookup.onsuccess = () => {
    rows = lookup.result;
    for (const row of rows) {
      const r = t.objectStore("photos").get(row.id);
      r.onsuccess = () => photos.set(row.id, r.result);
    }
  };
  await complete;
  if (rows.length > BACKUP_LIMITS.records)
    throw new Error("凭证超过 5000 张，请减少后备份");
  const ids = new Set(),
    paths = new Set();
  for (const row of rows) {
    validateBackupRow(row, ids, paths);
    ids.add(row.id);
    paths.add(row.photo);
  }
  const json = JSON.stringify(
    rows.map(({ elapsedMs, model, ...r }) => r),
    null,
    2,
  );
  const jsonBytes = new TextEncoder().encode(json).byteLength;
  if (jsonBytes > BACKUP_LIMITS.jsonBytes) throw new Error("备份记录文件过大");
  const z = new JSZip();
  z.file("receipts.json", json);
  let expanded = jsonBytes;
  for (const r of rows) {
    const b = photos.get(r.id);
    if (!b) throw new Error("存档照片缺失，备份未生成：" + r.name);
    const size = b.size ?? b.byteLength;
    if (size > BACKUP_LIMITS.photoBytes) throw new Error("备份照片过大");
    expanded += size;
    if (expanded > BACKUP_LIMITS.bytes) throw new Error("备份解压后过大");
    if ((await hash(new Blob([b]))) !== r.hash.toLowerCase())
      throw new Error("照片校验失败：" + r.name);
    z.file(r.photo, b);
  }
  const blob = await z.generateAsync({ type: "blob", compression: "STORE" });
  if (blob.size > BACKUP_LIMITS.bytes) throw new Error("备份超过 500 MB");
  return withSnapshot
    ? { blob, snapshot: snapshotOf(rows), count: rows.length }
    : blob;
}
export async function restoreZIP(file, { expectedSnapshot } = {}) {
  // Capture before decompression; compare inside the final write transaction.
  // The UI supplies the earlier safety-backup snapshot, including an empty DB.
  const expected = expectedSnapshot ?? snapshotOf(await records());
  const limit = BACKUP_LIMITS.bytes;
  const archiveBytes = file.size ?? file.byteLength;
  if (archiveBytes > limit) throw new Error("备份超过 500 MB");
  let z = await JSZip.loadAsync(file);
  checkArchiveLimits(z, archiveBytes);
  if (!z.file("receipts.json")) throw new Error("备份缺少 receipts.json");
  z = await JSZip.loadAsync(file, { checkCRC32: true });
  const rows = JSON.parse(await z.file("receipts.json").async("string"));
  if (!Array.isArray(rows) || rows.length > BACKUP_LIMITS.records)
    throw new Error("备份记录格式无效");
  const ids = new Set(),
    paths = new Set(),
    blobs = [],
    prepared = [];
  let expanded = 0;
  for (const r of rows) {
    validateBackupRow(r, ids, paths);
    ids.add(r.id);
    paths.add(r.photo);
    const entry = z.file(r.photo);
    if (!entry) throw new Error("备份中缺少照片：" + r.name);
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== r.photo)
      throw new Error("备份照片路径无效");
    const b = await entry.async("blob");
    expanded += b.size;
    if (expanded > limit) throw new Error("备份解压后过大");
    if ((await hash(b)) !== r.hash.toLowerCase())
      throw new Error("照片校验失败：" + r.name);
    blobs.push(b);
    const validated = parseReceipt([], r.fields);
    if (validated.fields.Type?.includes("转账")) {
      validated.fields.Payee = "";
      validated.fields.PayeeStatus = "hidden";
    }
    prepared.push({
      ...r,
      ...validated,
      hash: r.hash.toLowerCase(),
      revision: crypto.randomUUID(),
    });
  }
  const allowed = new Set(["receipts.json", ...paths]);
  if (Object.values(z.files).some((e) => !e.dir && !allowed.has(e.name)))
    throw new Error("备份中有未支持的文件");
  const d = await openDB(),
    t = d.transaction(["receipts", "photos"], "readwrite"),
    complete = done(t);
  let writeError;
  const lookup = t.objectStore("receipts").getAll();
  lookup.onsuccess = () => {
    try {
      if (snapshotOf(lookup.result) !== expected)
        throw new Error(
          "恢复期间凭证已在其他页面修改，请重试以重新备份最新数据",
        );
      for (const name of ["receipts", "photos"]) t.objectStore(name).clear();
      prepared.forEach((r, i) => {
        t.objectStore("receipts").put(r);
        t.objectStore("photos").put(blobs[i], r.id);
      });
    } catch (error) {
      writeError = error;
      t.abort();
    }
  };
  try {
    await complete;
  } catch (error) {
    throw writeError || error;
  }
  announceChange();
  return rows.length;
}
