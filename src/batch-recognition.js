// One cache per import operation. Reuse only byte-identical files, never
// similar-looking receipts, filenames, transaction numbers or edited records.
export function createBatchRecognizer(recognizeFile, fingerprint, limit = 64) {
  const results = new Map();
  return async (file, progress = () => {}) => {
    const hash = await fingerprint(file);
    if (results.has(hash)) {
      progress("正在保存识别结果…");
      return { hash, result: structuredClone(results.get(hash)), reused: true };
    }
    const result = await recognizeFile(file, progress);
    results.set(hash, structuredClone(result));
    if (results.size > limit) results.delete(results.keys().next().value);
    return { hash, result, reused: false };
  };
}
