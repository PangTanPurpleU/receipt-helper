import { ZipWriter, ZipReader, BlobWriter, BlobReader } from "@zip.js/zip.js/lib/zip-core-native.js";

const options = { useWebWorkers: false };
export function validateBackupPassword(password, confirmation = password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128)
    throw new Error("请设置 12～128 个字符的备份密码");
  if (password !== confirmation) throw new Error("两次输入的备份密码不一致");
  return password;
}
export async function isEncryptedBackup(file) {
  const blob = file instanceof Blob ? file : new Blob([file]);
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return header.length === 8 && header[0] === 80 && header[1] === 75 &&
    header[2] === 3 && header[3] === 4 && !!(header[6] & 1);
}
export async function encryptBackup(blob, password, limit) {
  validateBackupPassword(password);
  const writer = new ZipWriter(new BlobWriter("application/zip"), options);
  // One encrypted entry hides record names too. No custom cryptographic format.
  await writer.add("backup.zip", new BlobReader(blob), {
    password, encryptionStrength: 3, zipCrypto: false, level: 0,
  });
  const result = await writer.close();
  if (result.size > limit) throw new Error("加密备份超过 500 MB");
  return result;
}
export async function decryptBackup(file, password, limit) {
  const blob = file instanceof Blob ? file : new Blob([file]);
  if (blob.size > limit) throw new Error("备份超过 500 MB");
  if (!(await isEncryptedBackup(blob))) return blob;
  if (typeof password !== "string" || !password.length)
    throw new Error("此备份已加密，请输入备份密码");
  if (password.length > 128) throw new Error("备份密码过长");
  const reader = new ZipReader(new BlobReader(blob), options);
  try {
    let entry;
    for await (const item of reader.getEntriesGenerator()) {
      if (entry || item.filename !== "backup.zip" || item.directory || item.symlink || !item.encrypted || item.zipCrypto)
        throw new Error("加密备份格式无效");
      entry = item;
    }
    if (!entry || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > limit)
      throw new Error("加密备份大小无效或解密后过大");
    const chunks = [];
    let size = 0;
    const controller = new AbortController();
    const sink = new WritableStream({
      write(chunk) {
        size += chunk.length;
        if (size > limit || size > entry.uncompressedSize) {
          controller.abort();
          throw new Error("加密备份解密后过大或大小不符");
        }
        chunks.push(chunk);
      },
    });
    try {
      await entry.getData(sink, { password, checkSignature: true, signal: controller.signal });
      if (size !== entry.uncompressedSize) throw new Error("加密备份大小不符");
      return new Blob(chunks, { type: "application/zip" });
    } catch (error) {
      chunks.length = 0;
      if (/password|signature|authentication/i.test(error.message))
        throw new Error("备份密码错误或加密文件已损坏，请检查后重试");
      throw error;
    }
  } finally { await reader.close(); }
}
