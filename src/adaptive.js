import { parseMoney } from "./money.js";
// Unknown layouts use labelled evidence, not a guessed payment provider.
// Preserve source text; never substitute discounts, refunds or account numbers.
const groups = {
  Amount: [
    "实付金额|实际支付|实付|支付金额|付款金额|扣款金额",
    "价税合计|应付金额|合计金额|总金额|总计|合计|金额|小写",
  ],
  Traded: [
    "支付时间|付款时间|交易时间|转账时间",
    "交易日期|支付日期|开票日期|日期",
    "时间",
  ],
  Payee: [
    "商户名称|商家名称|商户全称|商户简称|收款人|收款方|收款单位|销售方名称|店名",
  ],
  Payer: ["付款人|付款方|付款单位|购买方名称"],
  Transaction: [
    "交易流水号|银行流水号|交易单号|转账单号|订单编号|订单号|流水号|凭证号|票据号码|发票号码|参考号",
  ],
  ProductDescription: [
    "商品说明|商品名称|商品|服务名称|项目名称|用途|摘要|交易说明",
  ],
  Source: ["出具机构|开票机构|支付平台|银行名称"],
  TradeStatus: ["交易状态|支付状态|当前状态"],
  Note: ["备注"],
};
const label =
  Object.values(groups).flat().join("|") +
  "|原价|优惠|退款金额|税额|单价|数量|支付方式|收单机构|商户单号|付款账号|收款账号";
const columns = new RegExp("\\s+(?=(?:" + label + ")[：:])");
const boundary = new RegExp("^(?:" + label + ")(?:[：:\\s]|$|(?=[+\\-¥￥\\d]))");
function entries(lines, pattern) {
  const re = new RegExp(
    "^(?:" + pattern + ")(?:[：:\\s]+|$|(?=[¥￥\\d]))(.*)$",
  );
  return lines.flatMap((line, i) => {
    const m = re.exec(line);
    if (!m) return [];
    let value = m[1].trim();
    if (!value) {
      for (
        let j = i + 1;
        j < Math.min(lines.length, i + 4) && !boundary.test(lines[j]);
        j++
      )
        value += (value ? " " : "") + lines[j];
    }
    return [value];
  });
}
const money = parseMoney;
function date(value) {
  const m = value.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return "";
  const day = m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  return m[4]
    ? day + " " + m[4].padStart(2, "0") + ":" + m[5] + (m[6] ? ":" + m[6] : "")
    : day;
}
export function parseAdaptive(input) {
  const lines = input
      .flatMap((s) => s.split("\n"))
      .flatMap((s) => s.normalize("NFKC").trim().split(columns))
      .filter((s) => s && s !== "其他凭证" && s !== "通用凭证"),
    f = { Type: "通用凭证" };
  for (const [key, priorities] of Object.entries(groups))
    for (const pattern of priorities) {
      const values = entries(lines, pattern);
      if (!values.length) continue;
      const candidates = values
          .map((v) =>
            key === "Amount" ? money(v) : key === "Traded" ? date(v) : v,
          )
          .filter(Boolean),
        unique = [...new Set(candidates)];
      if (unique.length === 1 && candidates.length === values.length)
        f[key] = unique[0];
      break;
    }
  if (f.Transaction) {
    f.Transaction = f.Transaction.replace(/\s/g, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(f.Transaction))
      delete f.Transaction;
  }
  // An unlabelled heading is useful for a shop receipt, but service/footer text is not.
  const heading = lines[0];
  if (
    !f.Payee &&
    heading &&
    !boundary.test(heading) &&
    /店|商场|超市|餐厅|饭馆|咖啡|便利|药房/.test(heading) &&
    heading.length < 60
  )
    f.Payee = heading;
  // A standalone signed/currency amount is usable only when it is unique.
  if (!f.Amount && !entries(lines, groups.Amount.join("|")).length) {
    const amounts = [
      ...new Set(
        lines
          .filter((v) => /^[-+¥￥]/.test(v))
          .map((v) => money(v.replace(/^[-+]/, "")))
          .filter(Boolean),
      ),
    ];
    if (amounts.length === 1) {
      f.Amount = amounts[0];
      if (lines.some((v) => /^\+/.test(v) && money(v.slice(1)) === f.Amount))
        f.Direction = "收入";
    }
  }
  return f;
}
export function adaptiveDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(value || ""))
    return null;
  const full =
      value.length === 10
        ? value + " 00:00:00"
        : value.length === 16
          ? value + ":00"
          : value,
    d = new Date(full.replace(" ", "T") + "Z");
  return Number.isFinite(+d) &&
    d.toISOString().slice(0, 19).replace("T", " ") === full
    ? +d
    : null;
}
