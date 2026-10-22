import { prepareBackup, BACKUP_LIMITS } from "./storage.js";
import { encryptBackup } from "./backup-crypto.js";
self.onmessage = async ({ data }) => {
  try {
    const result = data.operation === "encrypt"
      ? { blob: await encryptBackup(data.file, data.password, BACKUP_LIMITS.bytes) }
      : await prepareBackup(data.file, data.password);
    self.postMessage({ result });
  }
  catch (error) { self.postMessage({ error: error.message || "备份格式无效" }); }
};
