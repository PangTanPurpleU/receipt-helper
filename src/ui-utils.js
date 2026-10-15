export const storageError = (e) =>
  e?.name === "QuotaExceededError"
    ? "浏览器存储空间不足，请先导出备份并释放设备空间后重试。"
    : e?.message || String(e);
// Persistent storage is a best-effort request; denial must not block saving.
export async function requestPersistence(
  storage = globalThis.navigator?.storage,
) {
  try {
    return Boolean(await storage?.persist?.());
  } catch {
    return false;
  }
}
export function localDay(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
import { parseMoney } from "./money.js";
// Normalize only structured fields. Preserve free text and merchant letters.
export function normalizeEditedFields(fields) {
  const result = { ...fields };
  for (const key of ["Transaction", "Certificate", "MerchantOrder"])
    if (typeof result[key] === "string")
      result[key] = result[key].normalize("NFKC").replace(/\s+/g, "");
  for (const key of ["Traded", "Applied", "Received", "RefundTime"])
    if (typeof result[key] === "string")
      result[key] = result[key].normalize("NFKC").trim();
  if (typeof result.Amount === "string")
    result.Amount = parseMoney(result.Amount) || result.Amount.trim();
  return result;
}

export function formatTotal(value) {
  const [whole, fraction = "00"] = value.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction;
}
