#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 24 LTS，再打开此文件。官网：https://nodejs.org/'
  read '?按回车结束…'
  exit 1
fi
node tools/serve.mjs
read '?按回车关闭窗口…'
