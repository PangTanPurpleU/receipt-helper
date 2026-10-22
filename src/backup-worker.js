import { prepareBackup } from "./storage.js";
self.onmessage = async ({ data }) => {
  try { self.postMessage({ result: await prepareBackup(data) }); }
  catch (error) { self.postMessage({ error: error.message || "备份格式无效" }); }
};
