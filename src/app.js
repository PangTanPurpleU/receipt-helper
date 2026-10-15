import { APP_VERSION } from "./version.js";
import { waitForOfflineRuntime } from "./offline-runtime.js";
import {
  requestPersistence,
  storageError,
  localDay,
  normalizeEditedFields,
  formatTotal,
} from "./ui-utils.js";
import {
  receiptTypes,
  isWechatScreenshot,
  isScreenshot,
} from "./receipt-types.js";
import {
  records,
  save,
  photo,
  remove,
  hash,
  backup,
  restoreZIP,
  openDB,
} from "./storage.js";
import {
  receiptFieldDefs,
  payee,
  summary,
  peerMap,
  filtered,
  parseReceipt,
  transfer,
} from "./core.js";
import { recognize, dispose, initialize } from "./ocr.js";
import { exportExcel } from "./excel.js";
import { getModelStore, pruneRetiredModels } from "./model-cache.js";
import { LOCAL_MODELS } from "./models.js";
import { MODEL_VERSION } from "./model-assets.js";
import { createBatchRecognizer } from "./batch-recognition.js";
import { bindReceiptGestures } from "./receipt-gesture.js";
import { createPageMotion } from "./page-motion.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
const paths = {
  scanText:
    "M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h8M7 12h10M7 16h6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  photo:
    "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m-1 14 5-5 4 4 3-3 6 6M8 8h.01",
  download: "M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  export: "M12 16V3m-4 4 4-4 4 4M4 13v8h16v-8",
  arrow: "m9 5 7 7-7 7",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3m-4 9 3 3 5-6",
  select: "M3 3h18v18H3z m4 9 3 3 7-7",
  repeat:
    "M4 8a9 9 0 0 1 15-3l2 3M21 3v5h-5M20 16a9 9 0 0 1-15 3l-2-3M3 21v-5h5",
};
const icon = (n) =>
  n === "more"
    ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n]}"/></svg>`;
let rows = [],
  peers = new Map(),
  selected = new Set(),
  selection = false,
  filter = "all",
  busy = false,
  urls = [],
  active = null,
  confirmAction = null,
  lastFocus,
  detailRequest = 0;
let externalChange = false;
const model = "paddle-v6-tiny";
try {
  localStorage.setItem("receipt-ocr-model", model);
} catch {}
let modelStore = getModelStore(model);
$("#app").innerHTML =
  `<header><a class="brand" href="./" aria-label="凭证查重助手首页"><img src="./icon.png" alt=""><span>凭证查重助手</span></a><nav aria-label="工具"><button class="icon" id="moreToggle" aria-label="更多操作" aria-expanded="false" aria-controls="menu" aria-haspopup="menu">${icon("more")}</button></nav><div class="menu" id="menu" role="menu" aria-label="更多操作" hidden><div class="menuGroup" role="none"><button role="menuitem" tabindex="-1" id="excel">导出为Excel表格</button></div><div class="menuGroup" role="none"><button role="menuitem" tabindex="-1" id="backup">备份当前凭证</button><button role="menuitem" tabindex="-1" id="restore">恢复备份</button></div><div class="menuGroup" role="none"><button role="menuitem" tabindex="-1" id="reocr">重新识别全部凭证</button></div></div></header><main><section class="intro"><div class="introContent"><p>本地识别 · 照片不上传</p></div></section><div class="overview" id="overview"><section class="stats" aria-label="凭证统计"><div><small>总金额 · 元</small><strong id="total">0.00</strong><span id="totalNote">暂无凭证</span></div><div><small>已保存凭证</small><strong id="count">0</strong><span>本地存储</span></div><div><small>重复凭证</small><strong id="duplicates">0</strong><span id="reviewCount">0 张待核对</span></div></section><section class="modelCard" id="modelCard" data-state="checking" aria-labelledby="modelTitle"><div class="modelHeading"><span class="modelGlyph">${icon("scanText")}</span><div><h2 id="modelTitle">OCR 视觉识别模型</h2><div class="modelStatus" role="status" aria-live="polite"><span class="statusLight" aria-hidden="true"></span><span id="modelStatus">正在检查</span></div><span id="modelReadyHint" class="modelReadyHint" hidden>可离线识别 · 照片不上传</span></div></div><p id="modelDescription">正在检查此浏览器中的识别资源。</p><div class="modelDownloadProgress" id="modelDownloadProgress" hidden><progress id="modelProgress" max="100" value="0" aria-label="识别模型下载进度"></progress><span id="modelProgressText"></span></div><div class="modelControls"><button class="secondary" id="downloadModel" disabled>${icon("download")}<span>下载识别模型</span></button><button id="cancelModel" class="textButton" hidden>取消下载</button><span class="modelPrivacy">仅下载模型 · 照片不上传</span></div></section></div><section class="library" aria-label="凭证列表"><div class="libraryHead filterRow"><div class="filters" role="group" aria-label="筛选凭证"><button data-filter="all" aria-pressed="true">全部</button><button data-filter="duplicates" aria-pressed="false">重复</button><button data-filter="review" aria-pressed="false">待核对</button></div><button class="primary importButton" id="import">${icon("photo")}导入照片</button></div><div class="libraryTools"><div id="selectionBar" hidden><span id="selectedCount"></span><button id="selectAll">全选当前结果</button><button id="deleteSelected" class="danger">删除所选</button></div><p id="selectionHint" class="selectionHint" hidden>长按凭证可多选</p></div><div id="importErrors" class="notice warn" role="status" hidden></div><div id="list"></div></section><footer><span class="footerPrivacy">${icon("shield")} 免费识别 · 无账号同步 · 凭证不上传</span><span class="appVersion">版本 v${APP_VERSION}</span></footer></main><input type="file" id="files" accept="image/*" multiple hidden><input type="file" id="zip" accept=".zip,application/zip" hidden><dialog id="progress" aria-labelledby="progressTitle" aria-describedby="progressPrivacy"><div class="recognitionHeading"><span class="recognitionGlyph">${icon("photo")}<span class="spinner"></span></span><span class="recognitionEyebrow">设备本地处理</span><h2 id="progressTitle">正在识别凭证</h2></div><div class="recognitionMetrics"><span id="progressCount" role="status" aria-live="polite">已处理 0 / 0 张</span><strong id="progressPercent">0<span>%</span></strong></div><progress id="recognitionProgress" max="100" value="0" aria-label="凭证处理进度"></progress><p id="progressFile" class="recognitionFile"></p><p id="progressPrivacy">照片不上传，请保持页面打开</p></dialog><div id="toast" role="status" hidden></div><dialog id="detail"><div id="detailBody"></div></dialog><dialog id="confirm"><h2 id="confirmTitle"></h2><p id="confirmText"></p><div class="actions"><button id="confirmCancel">取消</button><button id="confirmOK" class="danger">确认</button></div></dialog>`;
const pageMotion = createPageMotion({
  intro: $(".introContent"),
  overview: $(".overview"),
  list: $("#list"),
});
let modelState = { ready: false, bytes: 0, total: modelStore.total },
  modelDownloading = false,
  modelChecking = true,
  modelAbort;
const offlineRegistration =
  "serviceWorker" in navigator
    ? navigator.serviceWorker
        .register(new URL("sw.js", import.meta.url))
        .catch(() => null)
    : Promise.resolve(null);
function focusModel() {
  $("#modelCard").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "center",
  });
  $("#downloadModel").focus({ preventScroll: true });
}
function displayModel(state, error = "") {
  modelState = state;
  const ready = state.ready,
    partial = state.bytes > 0;
  const visualState = modelDownloading
    ? "downloading"
    : ready
      ? "ready"
      : "missing";
  $("#modelCard").dataset.state = visualState;
  $("#modelReadyHint").hidden = !ready || modelDownloading;
  $("#modelStatus").textContent = modelDownloading
    ? "正在下载"
    : ready
      ? "准备就绪"
      : error
        ? "下载未完成"
        : partial
          ? "未完整下载"
          : "尚未下载";
  $("#modelDescription").textContent = ready
    ? LOCAL_MODELS.find((m) => m.id === model).description +
      " 已下载，导入照片即可识别。"
    : error ||
      `需下载约 ${Math.ceil((state.total - state.bytes) / 1024 / 1024)} MB 识别资源，之后导入无需等待模型下载。`;

  $("#downloadModel").hidden = ready;
  $("#downloadModel").innerHTML =
    icon("download") + `<span>${partial ? "继续下载" : "下载识别模型"}</span>`;
  $("#downloadModel").setAttribute(
    "aria-label",
    partial ? "继续下载" : "下载识别模型",
  );
  $("#downloadModel").disabled = busy || modelDownloading;
  $("#cancelModel").hidden = !modelDownloading;
  $("#modelDownloadProgress").hidden = !modelDownloading;
  $("#reocr").disabled = busy || modelDownloading;
}
async function checkModel(options) {
  if (modelDownloading || (modelChecking && checkModel.running))
    return modelState;
  modelChecking = true;
  $("#downloadModel").disabled = true;
  checkModel.running = true;
  try {
    const state = await modelStore.inspect(options);
    if (options?.migrate) await pruneRetiredModels();
    displayModel(state);
    if (state.ready && options?.migrate)
      await Promise.all(
        (await caches.keys())
          .filter((k) => k.startsWith("receipt-pages-"))
          .map((k) => caches.delete(k)),
      );
  } catch (e) {
    displayModel({ ...modelState, ready: false }, e.message);
  } finally {
    modelChecking = false;
    checkModel.running = false;
    $("#downloadModel").disabled = busy || modelDownloading;
  }
  return modelState;
}
async function offlineRuntime() {
  await waitForOfflineRuntime(offlineRegistration, {
    serviceWorker: navigator.serviceWorker,
    version: "receipt-ocr-v5-v1:" + MODEL_VERSION,
  });
}
async function requireModel() {
  if (modelDownloading) {
    focusModel();
    toast("请等待模型下载完成");
    return false;
  }
  const s = await checkModel();
  if (!s.ready) {
    await dispose();
    focusModel();
    toast("本地识别模型尚未完整下载，请先下载");
    return false;
  }
  try {
    await offlineRuntime();
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}
$("#downloadModel").onclick = async () => {
  if (busy || modelDownloading || modelState.ready) return;
  modelDownloading = true;
  modelAbort = new AbortController();
  displayModel(modelState);
  $("#cancelModel").disabled = false;
  let last = 0;
  try {
    await offlineRuntime();
    await requestPersistence();
    const s = await modelStore.download({
      signal: modelAbort.signal,
      onProgress: (p) => {
        if (performance.now() - last < 100 && p.bytes !== p.total) return;
        last = performance.now();
        $("#modelProgress").value = Math.floor((p.bytes / p.total) * 100);
        $("#modelProgressText").textContent =
          `${Math.min(100, Math.floor((p.bytes / p.total) * 100))}% · ${(p.bytes / 1024 / 1024).toFixed(1)} / ${(p.total / 1024 / 1024).toFixed(1)} MB${p.stage === "verifying" ? " · 校验中" : ""}`;
      },
    });
    modelDownloading = false;
    displayModel(s);
    toast("识别模型已下载，导入照片即可识别");
  } catch (e) {
    modelDownloading = false;
    let s;
    try {
      s = await modelStore.inspect();
    } catch {
      s = { ...modelState, ready: false };
    }
    displayModel(
      s,
      modelAbort.signal.aborted
        ? "下载已取消，已保存的资源会保留，可继续下载。"
        : e.name === "QuotaExceededError"
          ? "浏览器存储空间不足，请释放设备空间后重试。"
          : e.message,
    );
  } finally {
    modelAbort = null;
  }
};
$("#cancelModel").onclick = () => {
  modelAbort?.abort();
  $("#cancelModel").disabled = true;
};
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
function batchProgress(completed, total, name = "") {
  const percent = Math.floor((completed / total) * 100);
  $("#progressCount").textContent = `已处理 ${completed} / ${total} 张`;
  $("#progressPercent").innerHTML = `${percent}<span>%</span>`;
  $("#recognitionProgress").value = percent;
  $("#progressFile").textContent = name;
}
function setBusy(value) {
  busy = value;
  if (value) {
    $("#progressTitle").textContent = "正在识别凭证";
    batchProgress(0, 1);
    $("#progressFile").textContent = "";
    $("#progress").showModal();
  } else $("#progress").close();
  for (const s of [
    "#import",
    "#reocr",
    "#restore",
    "#excel",
    "#backup",
    "#selectAll",
    "#deleteSelected",
  ])
    $(s).disabled = value;
  $("#downloadModel").disabled = value || modelChecking;
  $("#reocr").disabled = value || modelDownloading;
  if (!value) {
    render();
    if (externalChange) {
      externalChange = false;
      void refresh().catch((e) => toast(storageError(e)));
    }
  }
}
async function refresh() {
  rows = await records();
  rows.sort((a, b) => (b.imported || "").localeCompare(a.imported || ""));
  peers = peerMap(rows);
  render();
}
function visible() {
  return filtered(rows, "", filter === "duplicates", peers).filter(
    (r) => filter !== "review" || r.warning,
  );
}
function render() {
  const focusedId =
    document.activeElement?.closest("#list [data-id]")?.dataset.id;
  const ids = new Set(rows.map((r) => r.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  selection = selected.size > 0;
  const sum = summary(rows);
  $("#total").textContent = formatTotal(sum.value);
  $("#total").style.setProperty(
    "--total-chars",
    $("#total").textContent.length,
  );
  $("#totalNote").textContent = sum.invalid
    ? `${sum.invalid} 张金额未识别，未计入`
    : "已识别金额合计";
  $("#count").textContent = rows.length;
  $("#duplicates").textContent = peers.size;
  $("#reviewCount").textContent =
    rows.filter((r) => r.warning).length + " 张待核对";
  const list = visible();
  $("#selectionBar").hidden = !selection;
  $("#selectionHint").hidden = selection || !list.length;
  $("#selectedCount").textContent = `已选 ${selected.size} 张`;
  $("#deleteSelected").disabled = busy || !selected.size;
  $("#selectAll").disabled = busy || !list.length;
  const displayed = visible();
  $("#selectAll").textContent =
    displayed.length && displayed.every((r) => selected.has(r.id))
      ? "取消全选"
      : "全选当前结果";
  $("#list").innerHTML = list.length
    ? list
        .map(
          (r) =>
            `<button class="receipt ${selected.has(r.id) ? "chosen" : ""}" data-id="${esc(r.id)}" aria-keyshortcuts="Shift+Space" aria-label="${esc((selection ? "选择 " : "查看 ") + r.name)}" ${selection ? `aria-pressed="${selected.has(r.id)}"` : ""}><div class="receiptMark ${peers.has(r.id) ? "duplicate" : ""}">${selection ? icon(selected.has(r.id) ? "check" : "select") : icon(peers.has(r.id) ? "repeat" : "check")}</div><div class="receiptText"><div class="receiptTitle"><strong ${r.fields.ProductDescription?.trim() ? 'class="productTitle"' : ""}>${esc(r.fields.ProductDescription?.trim() ? r.fields.ProductDescription : payee(r))}</strong><b>¥ ${esc(r.fields.Amount || "—")}</b></div><div class="receiptMeta"><span>${esc(r.fields.Traded || "交易时间未识别")}</span><span>${esc(r.name)}</span></div><div class="receiptStatus">${isScreenshot(r.fields) ? `<span class="badge sourceBadge">${isWechatScreenshot(r.fields) ? "微信截图" : "支付宝截图"}</span>` : ""}${peers.has(r.id) ? '<span class="badge red">发现重复</span>' : '<span class="badge">未发现重复</span>'}${r.warning ? `<span class="warning">${esc(r.warning)}</span>` : ""}</div></div>${!selection ? icon("arrow") : ""}</button>`,
        )
        .join("")
    : `<div class="empty" role="status"><span class="emptyIcon" aria-hidden="true">${icon("photo")}</span><p>${rows.length ? "暂无匹配凭证" : "等待导入"}</p></div>`;
  if (focusedId)
    [...$("#list").querySelectorAll("[data-id]")]
      .find((node) => node.dataset.id === focusedId)
      ?.focus({ preventScroll: true });
  pageMotion.observeReceipts();
}
bindReceiptGestures($("#list"), {
  isBusy: () => busy,
  isSelecting: () => selection,
  enter: (id) => {
    closeMenu();
    selected.add(id);
    render();
  },
  toggle: (id) => {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    render();
  },
  open: showDetail,
});
function confirm(title, text, action, label = "删除") {
  lastFocus = document.activeElement;
  confirmAction = action;
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  $("#confirmOK").textContent = label;
  $("#confirm").showModal();
}
$("#confirmCancel").onclick = () => $("#confirm").close();
$("#confirm").onclose = () => lastFocus?.focus();
$("#confirmOK").onclick = async () => {
  const action = confirmAction;
  $("#confirm").close();
  try {
    await action();
  } catch (e) {
    toast(storageError(e));
  }
};
function closeDetail() {
  detailRequest++;
  $("#detail").close();
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  active = null;
}
$("#detail").addEventListener("close", () => {
  if ($("#detail").open) return;
  detailRequest++;
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  active = null;
});
async function showDetail(id, draft = null, original = null) {
  // Layout changes must preserve the revision from when this editor opened.
  let r = original || rows.find((r) => r.id === id);
  if (!r) return;
  active = id;
  const request = ++detailRequest;
  let b;
  try {
    b = await photo(id);
  } catch (e) {
    toast(storageError(e));
    return false;
  }
  if (active !== id || request !== detailRequest) return false;
  for (const old of urls) URL.revokeObjectURL(old);
  urls = [];
  if (draft) r = { ...r, fields: draft };
  const u = b ? URL.createObjectURL(b) : "";
  urls.push(u);
  const duplicates = peers.get(id) || [];
  $("#detailBody").innerHTML =
    `<div class="dialogHeader"><div><small>${esc(r.name)}</small><h2>凭证详情</h2></div><button id="detailClose" class="icon" aria-label="关闭详情">${icon("close")}</button></div><div class="detailGrid"><div>${u ? `<a href="${u}" target="_blank" rel="noopener"><img class="receiptPhoto" src="${u}" alt="原始凭证，点击放大"></a>` : ""}</div><div><div class="notice ${r.warning ? "warn" : ""}">${esc(r.warning || "关键信息已识别，请与原图核对。")}</div>${duplicates.length ? `<div class="duplicateInfo"><strong>与 ${duplicates.length} 张凭证重复</strong>${duplicates.map((p) => `<p>${esc(rows.find((x) => x.id === p.id)?.name)}<br>${esc(p.reasons.join("、"))}</p>`).join("")}</div>` : ""}<form id="edit"><label>凭证类型<select name="Type">${receiptTypes.map((t) => `<option ${r.fields.Type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${receiptFieldDefs(
      r.fields,
    )
      .map(([k, l]) =>
        k === "PaymentKind"
          ? `<label>${l}<select name="PaymentKind">${["商户支付", "扫码付款", "个人转账"].map((v) => `<option ${v === r.fields.PaymentKind ? "selected" : ""}>${v}</option>`).join("")}</select></label>`
          : `<label>${l}<input name="${k}" value="${esc(r.fields[k])}" ${k === "Amount" ? 'inputmode="decimal"' : ""} ${["Transaction", "Certificate", "MerchantOrder"].includes(k) ? 'class="number" autocapitalize="off" autocorrect="off" spellcheck="false"' : ""}></label>`,
      )
      .join(
        "",
      )}${transfer(r) ? '<p class="muted">收款方已隐藏，无需填写。</p>' : ""}<p id="saveError" class="notice warn" role="alert" hidden></p><button class="primary" type="submit">保存核对结果</button></form><details><summary>识别原文</summary><pre>${esc(r.raw)}</pre></details></div></div><div class="detailActions"><button id="singleReocr">${icon("repeat")}重新识别</button><button id="singleDelete" class="danger">${icon("trash")}删除凭证</button></div>`;
  $("#detailClose").onclick = closeDetail;
  for (const select of $("#edit").querySelectorAll("select"))
    select.onchange = async () => {
      const name = select.name,
        draft = {
          ...r.fields,
          ...Object.fromEntries(new FormData($("#edit"))),
        },
        controls = [...$("#edit").querySelectorAll("input,select,button")];
      if (isWechatScreenshot(draft) && !draft.PaymentKind)
        draft.PaymentKind = "商户支付";
      for (const control of controls) control.disabled = true;
      try {
        const rendered = await showDetail(id, draft, r);
        if (rendered && active === id)
          $('#edit select[name="' + name + '"]').focus({ preventScroll: true });
      } finally {
        for (const control of controls) control.disabled = false;
      }
    };
  $("#edit").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      button = form.querySelector("button[type=submit]");
    if (button.disabled) return;
    const f = normalizeEditedFields({
      ...r.fields,
      ...Object.fromEntries(new FormData(form)),
    });
    if (f.Type.includes("转账")) {
      f.Payee = "";
      f.PayeeStatus = "hidden";
    } else delete f.PayeeStatus;
    const savingRequest = detailRequest;
    const controls = [...form.querySelectorAll("input,select,button")];
    for (const control of controls) control.disabled = true;
    form.querySelector("#saveError").hidden = true;
    button.textContent = "正在保存…";
    try {
      const validated = parseReceipt([], f);
      await save({ ...r, fields: f, warning: validated.warning }, undefined, {
        expectedRevision: r.revision ?? null,
      });
      await refresh();
      if (active === id && detailRequest === savingRequest) closeDetail();
      toast("核对结果已保存");
    } catch (error) {
      const message = storageError(error);
      if (form.isConnected) {
        const feedback = form.querySelector("#saveError");
        feedback.textContent = message;
        feedback.hidden = false;
        feedback.scrollIntoView({ block: "nearest" });
      } else toast(message);
    } finally {
      for (const control of controls) control.disabled = false;
      button.textContent = "保存核对结果";
    }
  };
  $("#singleDelete").onclick = () =>
    confirm(
      "删除这张凭证？",
      "仅删除这条凭证的识别记录，手机相册原图不受影响。记录删除后无法恢复。",
      async () => {
        await remove([id]);
        closeDetail();
        await refresh();
        toast("已删除 1 张凭证");
      },
    );
  $("#singleReocr").onclick = () =>
    confirm(
      "重新识别这张凭证？",
      "新的识别结果会替换已填写的字段。",
      async () => {
        closeDetail();
        await runRows([r]);
      },
      "重新识别",
    );
  if (busy)
    for (const control of $("#edit").querySelectorAll("input,select,button"))
      control.disabled = true;
  $("#singleReocr").disabled = busy;
  $("#singleDelete").disabled = busy;
  if (!$("#detail").open) $("#detail").showModal();
  return true;
}
async function runRows(items) {
  if (busy || !items.length) return;
  if (!(await requireModel()) || busy) return;
  setBusy(true);
  batchProgress(0, items.length);
  $("#importErrors").hidden = true;
  let count = 0,
    processed = 0,
    failed = 0,
    lastError = "";
  const recognizeBatch = createBatchRecognizer(
    (file, progress) => recognize(file, model, progress),
    hash,
  );
  try {
    for (const r of items) {
      batchProgress(processed, items.length, r.name);
      try {
        const blob = await photo(r.id);
        if (!blob) throw new Error("存档照片缺失");
        const { result } = await recognizeBatch(blob);
        await save({ ...r, ...result, model }, undefined, {
          expectedRevision: r.revision ?? null,
        });
        count++;
      } catch (e) {
        failed++;
        lastError = storageError(e);
        $("#importErrors").textContent = r.name + "：" + lastError;
        $("#importErrors").hidden = false;
        if (e.name === "QuotaExceededError") break;
      } finally {
        processed++;
        batchProgress(processed, items.length, r.name);
      }
    }
    await refresh();
    toast(
      `已重新识别 ${count} 张${failed ? `，${failed} 张未完成：${lastError}` : ""}`,
    );
  } finally {
    setBusy(false);
  }
}

async function importFiles(files) {
  if (busy) return;
  const items = Array.from(files);
  if (!items.length) return;
  if (!(await requireModel()) || busy) {
    $("#files").value = "";
    return;
  }
  setBusy(true);
  batchProgress(0, items.length);
  $("#importErrors").hidden = true;
  const recognizeBatch = createBatchRecognizer(
    (file, progress) => recognize(file, model, progress),
    hash,
  );
  let count = 0,
    failed = 0,
    lastError = "";
  try {
    await requestPersistence();
    for (let i = 0; i < items.length; i++) {
      const file = items[i];
      batchProgress(i, items.length, file.name);
      if (file.size > 30 * 1024 * 1024) {
        failed++;
        lastError = "超过 30 MB，请缩小后导入";
        $("#importErrors").textContent = file.name + "：" + lastError;
        $("#importErrors").hidden = false;
        toast(file.name + "：" + lastError);
        batchProgress(i + 1, items.length, file.name);
        continue;
      }
      const id = crypto.randomUUID(),
        r = {
          id,
          name: file.name,
          photo:
            "photos/" + id + "." + (/\.png$/i.test(file.name) ? "png" : "jpg"),
          imported: new Date().toISOString(),
          fields: {},
          raw: "",
          warning: "",
        };
      try {
        const recognized = await recognizeBatch(file);
        r.hash = recognized.hash;
        await save({ ...r, ...recognized.result, model }, file);
        count++;
      } catch (e) {
        failed++;
        lastError = storageError(e);
        $("#importErrors").textContent = file.name + "：" + lastError;
        $("#importErrors").hidden = false;
        toast(file.name + "：" + lastError);
      }
      batchProgress(i + 1, items.length, file.name);
    }
    toast(
      `已导入 ${count} 张${failed ? `，${failed} 张未完成：${lastError}` : ""}`,
    );
  } finally {
    try {
      await refresh();
    } finally {
      setBusy(false);
      $("#files").value = "";
    }
  }
}
function closeMenu() {
  if ($("#menu").contains(document.activeElement)) $("#moreToggle").focus();
  $("#menu").hidden = true;
  $("#moreToggle").setAttribute("aria-expanded", "false");
}
function openMenu(focus = false, last = false) {
  $("#menu").hidden = false;
  $("#moreToggle").setAttribute("aria-expanded", "true");
  if (focus) {
    const items = $("#menu").querySelectorAll("button:not(:disabled)");
    items[last ? items.length - 1 : 0]?.focus();
  }
}
$("#moreToggle").onclick = (e) =>
  $("#menu").hidden ? openMenu(e.detail === 0) : closeMenu();
$("#moreToggle").onkeydown = (e) => {
  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    openMenu(true, e.key === "ArrowUp");
  }
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("#menu,#moreToggle")) closeMenu();
});
$("#menu").onkeydown = (e) => {
  const items = [...$("#menu").querySelectorAll("button:not(:disabled)")],
    index = items.indexOf(document.activeElement);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  }
  if (e.key === "Tab") closeMenu();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
$("#selectAll").onclick = () => {
  const ids = visible().map((r) => r.id),
    all = ids.every((id) => selected.has(id));
  for (const id of ids) all ? selected.delete(id) : selected.add(id);
  render();
};
$("#deleteSelected").onclick = () =>
  confirm(
    `删除 ${selected.size} 张凭证？`,
    "仅删除所选凭证的识别记录，手机相册原图不受影响。记录删除后无法恢复。",
    async () => {
      const n = await remove([...selected]);
      selection = false;
      selected.clear();
      await refresh();
      toast(`已删除 ${n} 张凭证`);
    },
  );
for (const b of document.querySelectorAll("[data-filter]"))
  b.onclick = () => {
    filter = b.dataset.filter;
    for (const x of document.querySelectorAll("[data-filter]"))
      x.setAttribute("aria-pressed", x === b);
    render();
  };
$("#import").onclick = () => {
  if (modelState.ready && !modelDownloading) {
    $("#files").click();
    void offlineRuntime()
      .then(() => initialize(model))
      .catch(() => {});
  } else {
    focusModel();
    toast(
      modelDownloading
        ? "模型正在下载，完成后即可导入"
        : "请先下载本地识别模型",
    );
  }
};
$("#files").onchange = (e) => importFiles(e.target.files);
$("#progress").oncancel = (e) => e.preventDefault();
async function download(blob, name) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
const dated = localDay;
$("#excel").onclick = async () => {
  closeMenu();
  if (!rows.length) {
    toast("暂无可导出的凭证");
    return;
  }
  try {
    await download(await exportExcel(rows), "凭证查重助手-" + dated() + ".xlsx");
    toast("Excel 已生成，共 " + rows.length + " 张凭证");
  } catch (e) {
    toast(storageError(e));
  }
};
$("#backup").onclick = async () => {
  closeMenu();
  if (!rows.length) {
    toast("暂无可备份的凭证");
    return;
  }
  try {
    await download(await backup(), "凭证查重助手备份-" + dated() + ".zip");
    toast("备份已生成，请保存下载文件");
  } catch (e) {
    toast(storageError(e));
  }
};
$("#restore").onclick = () => {
  closeMenu();
  $("#zip").click();
};
$("#zip").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  confirm(
    "恢复备份？",
    "备份会替换当前列表。当前凭证会先自动下载 ZIP 备份。",
    async () => {
      if (busy) return;
      setBusy(true);
      $("#progressTitle").textContent = "正在恢复备份";
      $("#progressCount").textContent = "正在校验备份文件";
      $("#progressPercent").textContent = "";
      $("#recognitionProgress").removeAttribute("value");
      try {
        const safety = await backup({ withSnapshot: true });
        if (safety.count)
          await download(safety.blob, "恢复前自动备份-" + dated() + ".zip");
        const n = await restoreZIP(file, { expectedSnapshot: safety.snapshot });
        selected.clear();
        await refresh();
        toast(`已恢复 ${n} 张凭证`);
      } finally {
        setBusy(false);
        $("#zip").value = "";
      }
    },
    "恢复备份",
  );
};
$("#reocr").onclick = () => {
  closeMenu();
  if (!rows.length) {
    toast("暂无可重新识别的凭证");
    return;
  }
  confirm(
    "重新识别全部凭证？",
    "新的识别结果会替换已填写的字段。识别期间请保持页面打开。",
    () => runRows(rows),
    "重新识别",
  );
};
window.addEventListener("beforeunload", (e) => {
  if (busy || modelDownloading) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
});
try {
  await openDB();
  await refresh();
} catch (e) {
  toast("本地数据库不可用：" + e.message);
}
await checkModel({ migrate: true });
window.addEventListener("pageshow", () => {
  if (!busy && !modelDownloading) checkModel();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !busy && !modelDownloading) checkModel();
});

const changes =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("receipt-helper-changes")
    : null;
if (changes)
  changes.onmessage = () => {
    externalChange = true;
    if (!busy) {
      externalChange = false;
      void refresh().catch((e) => toast(storageError(e)));
    }
  };
