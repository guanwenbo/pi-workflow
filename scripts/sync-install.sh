#!/usr/bin/env bash
# 把仓库里的插件源码同步到 PI-Desktop 的安装目录，并生成「内嵌脚手架」。
#
# 为什么要内嵌脚手架：adopt_project 需要在**任何**工作区里都能拿到 .pi/commands 与 docs/templates；
# 安装态下 ~/.pi-desktop/plugins/installed/<id>/ 的上两级不是 pi-workflow 仓，探测不到源资产，
# 所以同步时把三件套复制进 assets/scaffold，由 resolveScaffoldRoot 在安装态命中。
#
# 用法：bash scripts/sync-install.sh            （同步 + 更新 registry.json 版本）
#      PI_PLUGINS_DIR=/path bash scripts/...   （改安装根目录）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="gwb.pi-workflow-gates"
PKG="$ROOT/packages/pi-workflow-gates" # 包目录名与插件 id 不同（历史原因）
PLUGINS_DIR="${PI_PLUGINS_DIR:-$HOME/.pi-desktop/plugins}"
DEST="$PLUGINS_DIR/installed/$ID"

[ -d "$DEST" ] || { echo "✘ 安装目录不存在：$DEST（请先在 PI-Desktop 里安装 $ID）" >&2; exit 1; }
[ -f "$PKG/manifest.json" ] || { echo "✘ 找不到插件源码：$PKG" >&2; exit 1; }

VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PKG/manifest.json','utf8')).version)")"

echo "→ 同步 $ID@$VERSION 到 $DEST"
rm -rf "$DEST/renderer"
cp "$PKG/main.js" "$DEST/main.js"
cp "$PKG/manifest.json" "$DEST/manifest.json"
cp "$PKG/README.md" "$DEST/README.md"
cp -R "$PKG/renderer" "$DEST/renderer"

# 内嵌脚手架：安装态下 adopt_project 的源资产
echo "→ 生成内嵌脚手架 assets/scaffold"
rm -rf "$DEST/assets/scaffold"
mkdir -p "$DEST/assets/scaffold/requirements"
cp -R "$ROOT/.pi" "$DEST/assets/scaffold/.pi"
cp -R "$ROOT/docs" "$DEST/assets/scaffold/docs"
cp "$ROOT/requirements/README.md" "$DEST/assets/scaffold/requirements/README.md"

# 注册表里的版本号必须与 manifest 一致（否则面板/宿主显示陈旧版本）
if [ -f "$PLUGINS_DIR/registry.json" ]; then
  node - "$PLUGINS_DIR/registry.json" "$ID" "$VERSION" <<'NODE'
const fs = require("fs");
const [file, id, version] = process.argv.slice(2);
const reg = JSON.parse(fs.readFileSync(file, "utf8"));
const list = Array.isArray(reg) ? reg : (reg.plugins || []);
const hit = list.find(p => p.id === id);
if (!hit) { console.error(`⚠ registry.json 里没有 ${id}，跳过版本同步`); process.exit(0); }
hit.version = version;
fs.writeFileSync(file, JSON.stringify(reg, null, 2) + "\n");
console.log(`→ registry.json 版本已置为 ${version}`);
NODE
fi

echo "✓ 完成：$DEST ($(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$DEST/manifest.json','utf8')).version)"))"
