import { validateBackupPassword } from "./backup-crypto.js";

export function requestBackupPassword({ restore = false, encrypted = false, safety = false } = {}) {
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "passwordDialog";
  dialog.setAttribute("aria-labelledby", "backupPasswordTitle");
  dialog.setAttribute("aria-describedby", "backupPasswordHint");
  dialog.innerHTML = `<form>
    <h2 id="backupPasswordTitle">${restore ? "恢复备份" : "加密备份"}</h2>
    <p id="backupPasswordHint">${restore
      ? "恢复会替换当前列表。" + (safety ? "当前凭证会先下载为加密安全备份。" : "") + (encrypted ? "请输入所选备份的密码。" : "所选文件为旧版未加密备份。")
      : "设置密码，保护备份中的全部凭证。可在本站恢复，或用支持 AES 的解压工具打开。"}</p>
    ${restore && encrypted ? '<label>所选备份的密码<input name="restorePassword" type="password" autocomplete="off" required maxlength="128"></label>' : ""}
    ${!restore || safety ? `<label>${restore ? "恢复前安全备份的新密码" : "备份密码"}<input name="backupPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
    <label>确认新密码<input name="confirmation" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
    <p>使用 12～128 个字符，建议使用较长且独有的密码。密码不会保存在网站中，忘记后无法恢复。</p>` : ""}
    <label class="passwordVisibility"><input type="checkbox" name="showPassword">显示密码</label>
    <p class="notice warn" role="alert" hidden></p>
    <div class="actions"><button type="button" class="cancelPassword">取消</button><button type="submit" class="primary">${restore ? "恢复备份" : "加密并下载"}</button></div>
  </form>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    const form = dialog.querySelector("form"), error = dialog.querySelector('[role="alert"]');
    let result = null;
    form.elements.showPassword.onchange = () => {
      for (const input of form.querySelectorAll('input:not([type="checkbox"])'))
        input.type = form.elements.showPassword.checked ? "text" : "password";
    };
    form.onsubmit = event => {
      event.preventDefault();
      try {
        const backupPassword = form.elements.backupPassword?.value;
        if (!restore || safety) validateBackupPassword(backupPassword, form.elements.confirmation.value);
        result = { password: form.elements.restorePassword?.value || "", backupPassword };
        dialog.close();
      } catch (e) { error.textContent = e.message; error.hidden = false; }
    };
    dialog.querySelector(".cancelPassword").onclick = () => dialog.close();
    dialog.onclose = () => {
      form.reset();
      for (const input of form.querySelectorAll("input")) input.value = "";
      dialog.remove(); previous?.focus(); resolve(result);
    };
    dialog.showModal();
  });
}
