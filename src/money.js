// Parse the complete field, never a numeric suffix of an unreadable amount.
// Comma-as-decimal repair is restricted to electronic certificates.
export function parseMoney(value, { decimalComma = false } = {}) {
  let text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/^(?:人民币|RMB|CNY)/i, "")
    .replace(/^[¥￥]/, "")
    .replace(/(?:元|RMB|CNY)$/i, "");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text))
    text = text.replaceAll(",", "");
  else if (decimalComma && /^\d+[,、]\d{2}$/.test(text))
    text = text.replace(/[,、]/, ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return "";
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER)
    ? whole.replace(/^0+(?=\d)/, "") + "." + fraction.padEnd(2, "0")
    : "";
}
