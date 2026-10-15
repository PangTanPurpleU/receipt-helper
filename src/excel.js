import { adaptiveDate } from "./adaptive.js";
import JSZip from "jszip";
import { dateValue, payee, summary, amountCents, peerMap } from "./core.js";
import {
  isAdaptive,
  isAlipay,
  isWechatScreenshot,
  isScreenshot,
} from "./receipt-types.js";
export async function exportExcel(rows, allRows = rows) {
  const z = new JSZip();
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    doc = "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const escape = (s) =>
    String(s ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  z.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `<Relationships xmlns="${rel}"><Relationship Id="r1" Type="${doc}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  z.file(
    "xl/workbook.xml",
    `<workbook xmlns="${ns}" xmlns:r="${doc}"><sheets><sheet name="凭证查重" sheetId="1" r:id="r1"/></sheets><calcPr calcMode="auto"/></workbook>`,
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="${rel}"><Relationship Id="r1" Type="${doc}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${doc}/styles" Target="styles.xml"/></Relationships>`,
  );
  const xf = (num, font, fill) =>
    `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`;
  z.file(
    "xl/styles.xml",
    `<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="11"/><name val="PingFang SC"/></font><font><b/><sz val="11"/><name val="PingFang SC"/></font><font><b/><color rgb="FFB42318"/><sz val="11"/><name val="PingFang SC"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4E2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5F2EF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6">${xf(0, 0, 0) + xf(164, 0, 0) + xf(165, 0, 0) + xf(0, 2, 2) + xf(0, 1, 3) + xf(164, 1, 0)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  const text = (ref, v, s = 0) =>
    `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escape(String(v ?? "").slice(0, 32760))}</t></is></c>`;
  const adaptive = rows.some((r) => isAdaptive(r.fields)),
    extended = rows.some((r) => isScreenshot(r.fields) || isAdaptive(r.fields)),
    wechat = rows.some((r) => isWechatScreenshot(r.fields)),
    onlyScreenshots = rows.every((r) => isAlipay(r.fields));
  const headers = extended
    ? [
        onlyScreenshots ? "支付时间" : "支付/交易时间",
        "支付金额（元）",
        "收款方",
        onlyScreenshots ? "订单号" : "订单/交易单号",
        "凭证类型",
        "商户显示名称",
        "商家订单号",
        "付款方式",
        "是否重复",
      ]
    : ["交易/转账时间", "金额", "收款方", "交易/转账单号", "是否重复"];
  if (wechat) {
    const onlyWechat = rows.every((r) => isWechatScreenshot(r.fields));
    headers[0] = onlyWechat ? "支付/转账时间" : "支付/交易/转账时间";
    headers[3] = onlyWechat ? "交易/转账单号" : "订单/交易/转账单号";
    headers[6] = onlyWechat ? "商户单号" : "商家/商户单号";
  }
  if (wechat)
    headers.push(
      "商品说明",
      "支付类型",
      "收款时间",
      "退款金额（元）",
      "退款时间",
      "交易状态",
      "原价",
      "优惠信息",
    );
  if (extended && !wechat) headers.push("商品说明");
  if (adaptive) headers.push("出具机构");
  const total = summary(rows),
    exactTotal = total.cents === null || total.cents >= 1e15;
  const lastColumn = String.fromCharCode(64 + headers.length);
  const widths = extended
    ? [24, 18, 36, 42, 24, 30, 42, 32, 14]
    : [24, 16, 36, 42, 14];
  if (wechat) widths.push(60, 18, 24, 18, 24, 26, 18, 36);
  if (extended && !wechat) widths.push(60);
  if (adaptive) widths.push(32);
  const sorted = rows
    .map((r, i) => ({
      r,
      i,
      date: isAdaptive(r.fields)
        ? adaptiveDate(r.fields.Traded)
        : dateValue(r.fields.Traded),
    }))
    .sort((a, b) =>
      a.date === b.date
        ? a.i - b.i
        : a.date === null
          ? 1
          : b.date === null
            ? -1
            : a.date - b.date,
    )
    .map((x) => x.r);
  const peers = peerMap(allRows);
  let sheet = `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData><row r="1" ht="30" customHeight="1">${text("A1", "总金额（元）", 4)}${exactTotal ? text("B1", total.value, 5) : `<c r="B1" s="5"><f>SUM(B3:B${Math.max(3, rows.length + 2)})</f><v>${total.value}</v></c>`}</row><row r="2" ht="28" customHeight="1">${headers.map((h, i) => text(String.fromCharCode(65 + i) + "2", h, 4)).join("")}</row>`;
  sorted.forEach((r, i) => {
    const n = i + 3,
      date = dateValue(r.fields.Traded),
      amount = amountCents(r.fields.Amount),
      dup = peers.has(r.id);
    sheet += `<row r="${n}" ht="32" customHeight="1">${date === null ? text("A" + n, r.fields.Traded) : `<c r="A${n}" s="2"><v>${date / 86400000 + 25569}</v></c>`}${amount === null ? text("B" + n, "") : amount >= 1e15 ? text("B" + n, r.fields.Amount) : `<c r="B${n}" s="1"><v>${(amount / 100).toFixed(2)}</v></c>`}${text("C" + n, payee(r))}${text("D" + n, r.fields.Transaction)}${extended ? [r.fields.Type, r.fields.PayeeDisplayName || "", r.fields.MerchantOrder || "", r.fields.PaymentMethod || ""].map((v, j) => text(String.fromCharCode(69 + j) + n, v)).join("") : ""}${text((extended ? "I" : "E") + n, dup ? "是" : "否", dup ? 3 : 0)}${
      wechat
        ? [
            ["ProductDescription", "text"],
            ["PaymentKind", "text"],
            ["Received", "date"],
            ["RefundAmount", "money"],
            ["RefundTime", "date"],
            ["TradeStatus", "text"],
            ["OrderAmount", "money"],
            ["Discount", "text"],
          ]
            .map(([key, type], j) => {
              const ref = String.fromCharCode(74 + j) + n,
                v = r.fields[key] || "",
                numeric =
                  type === "money"
                    ? amountCents(v)
                    : type === "date"
                      ? dateValue(v)
                      : null;
              return numeric === null
                ? text(ref, v)
                : `<c r="${ref}" s="${type === "money" ? 1 : 2}"><v>${type === "money" ? (numeric / 100).toFixed(2) : numeric / 86400000 + 25569}</v></c>`;
            })
            .join("")
        : ""
    }${extended && !wechat ? text("J" + n, r.fields.ProductDescription) : ""}${adaptive ? text((wechat ? "R" : "K") + n, r.fields.Source) : ""}</row>`;
  });
  sheet += `</sheetData><autoFilter ref="A2:${lastColumn}${rows.length + 2}"/></worksheet>`;
  z.file("xl/worksheets/sheet1.xml", sheet);
  return z.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}
