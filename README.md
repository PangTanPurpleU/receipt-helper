# 凭证查重助手

个人自用的凭证识别、查重与 Excel 导出工具。

[打开网站](https://pangtanpurpleu.github.io/receipt-helper/)

支持微信、支付宝凭证及截图识别，可核对字段、查看重复记录、导出 Excel 和备份恢复。

照片和记录保存在当前浏览器，不上传、不同步。首次使用需下载识别模型，之后可离线识别。重要记录请定期导出 ZIP 备份。

## 本地维护

Node.js 24 · pnpm 11.25.0

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

推送 `main` 后由 GitHub Actions 自动部署。

技术细节见 [代码说明](docs/代码说明.md) 和 [部署说明](docs/部署与交付说明.md)。
