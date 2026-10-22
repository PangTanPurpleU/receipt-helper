const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
// JSZip is pinned. Its public stream API permits stopping output without
// accumulating the entire entry. Verify CRC ourselves to avoid eager all-file inflation.
export function readZipEntry(entry, limit) {
  const declared = entry._data?.uncompressedSize, expectedCRC = entry._data?.crc32;
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)
    return Promise.reject(new Error("备份文件解压后过大或大小无效"));
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0, crc = 0xffffffff, settled = false;
    const stream = entry.internalStream("uint8array");
    const fail = (error) => {
      if (settled) return;
      settled = true; stream.pause(); chunks = []; clearTimeout(timer); reject(error);
    };
    const timer = setTimeout(() => fail(new Error("备份解压超时，请检查文件")), 30000);
    stream.on("data", chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit || size > declared) { fail(new Error("备份文件解压后过大或声明大小不符")); return; }
      for (const byte of chunk) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
      chunks.push(chunk);
    }).on("error", fail).on("end", () => {
      if (settled) return;
      if (size !== declared || ((crc ^ 0xffffffff) >>> 0) !== (expectedCRC >>> 0)) {
        fail(new Error("备份 CRC32 或文件大小校验失败")); return;
      }
      settled = true; clearTimeout(timer);
      resolve(new Blob(chunks)); chunks = [];
    }).resume();
  });
}
