// Alipay bill screenshots have a large, unlabelled paid amount and no payer
// field. Keep their extraction separate from WeChat's tabular certificates.
const compact = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[−–—﹣]/g, "-");
const boundary =
  /^(?:支付时间|付款时间|付款方式|支付奖励|收款方全称|收款方|订单号|商家订单号|商品说明|收单机构|清算机构|乘车时间|订单金额|交易详情|服务详情|温馨提示|管理免密支付|管理极速付款|账单管理|账单分类|关联记录)/;
export function isAlipayLines(lines) {
  const t = lines.map(compact).join("\n");
  return (
    /账单详情/.test(t) &&
    /支付时间|付款时间/.test(t) &&
    /(?:^|\n)订单号/.test(t) &&
    /商家订单号|支付宝|管理免密支付|管理极速付款/.test(t)
  );
}
export function parseAlipay(input) {
  const all = input.flatMap((s) => s.split("\n")).map(compact),
    stop = all.findIndex((s) => /^账单管理/.test(s)),
    lines = stop < 0 ? all : all.slice(0, stop);
  function value(label, { join = false } = {}) {
    for (let i = 0; i < lines.length; i++) {
      const match = new RegExp("^(?:" + label + ")[:：]?").exec(lines[i]);
      if (!match) continue;
      let v = lines[i].slice(match[0].length);
      for (let j = i + 1; j < lines.length && j < i + 4; j++) {
        if (
          boundary.test(lines[j]) ||
          /^(?:交易成功|自动扣款成功|支付成功)$/.test(lines[j])
        )
          break;
        if (!v || join) v += lines[j];
        else break;
      }
      return v.replace(/[>›》]+$/, "");
    }
    return "";
  }
  const headerEnd = lines.findIndex(
    (s) =>
      boundary.test(s) ||
      /^(?:交易成功|自动扣款成功|支付成功|交易关闭|等待付款|退款成功)$/.test(s),
  );
  const amountIndex = lines.findIndex(
    (s, i) =>
      (headerEnd < 0 || i < headerEnd) &&
      /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(s),
  );
  const amountRaw = amountIndex >= 0 ? lines[amountIndex] : "",
    header = amountIndex < 0 ? [] : lines.slice(0, amountIndex);
  const full = value("收款方全称", { join: true }),
    display = header.at(-1)?.replace(/[>›》]+$/, "") || "";
  const time = value("支付时间|付款时间").match(
    /(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})/,
  );
  let order = value("订单号", { join: true });
  if (!/^\d+$/.test(order)) order = "";
  const merchant = value("商家订单号", { join: true });
  const f = {
    Type: "支付宝支付截图",
    Amount: amountRaw.replace(/^[+-]/, "").replaceAll(",", ""),
    Traded: time ? time[1] + " " + time[2] : "",
    Transaction: order,
    Payee: full || display,
    PayeeFullName: full,
    PayeeDisplayName: display,
    PaymentMethod: value("付款方式"),
    ProductDescription: value("商品说明", { join: true }).replace(
      /查看购物详情.*$/,
      "",
    ),
    MerchantOrder: /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(merchant)
      ? merchant
      : "",
    TradeStatus:
      lines.find((s) =>
        /^(?:交易成功|自动扣款成功|支付成功|交易关闭|等待付款|退款成功)$/.test(
          s,
        ),
      ) || "",
    OrderAmount: value("订单金额"),
    RideTime: value("乘车时间"),
    Acquirer: value("收单机构"),
    ClearingInstitution: value("清算机构"),
    Direction: amountRaw.startsWith("-") ? "支出" : amountRaw ? "收入" : "",
  };
  // Discounts are supplementary evidence, never a replacement for the headline
  // paid amount. Preserve the labels rather than merging them with the payment.
  f.Discount = lines
    .filter((s) =>
      /^(?:焕新折扣|工商银行立减(?:金)?|碰一下立减|优惠|优惠金额|立减)/.test(s),
    )
    .join("；");
  return f;
}
