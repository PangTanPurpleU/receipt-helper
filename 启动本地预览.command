#!/bin/zsh
cd -- "${0:A:h}"
# Finder does not always inherit the Node path used by a terminal or Codex.
for node_dir in /opt/homebrew/bin /usr/local/bin "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"; do
  if command -v node >/dev/null 2>&1; then break; fi
  if [[ -x "$node_dir/node" ]]; then export PATH="$node_dir:$PATH"; fi
done
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 24 LTS，再打开此文件。官网：https://nodejs.org/'
  read '?按回车结束…'
  exit 1
fi
node tools/serve.mjs
read '?按回车关闭窗口…'
