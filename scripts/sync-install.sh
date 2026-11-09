#!/usr/bin/env bash
# 把仓库里的插件源码同步到 PI-Desktop 的安装目录。
#
# 会先重建内嵌脚手架（scaffold.generated.js）：分发包里插件目录之外没有 pi-workflow 仓库，
# adopt_project 与斜杠命令只能靠这份内嵌副本，所以打包/同步前必须是最新的。
#
# 用法：bash scripts/sync-install.sh            （重建脚手架 + 同步 + 更新 registry.json 版本）
#      PI_PLUGINS_DIR=/path bash scripts/...   （改安装根目录）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="gwb.pi-workflow-gates"
PKG="$ROOT/packages/pi-workflow-gates"
PLUGINS_DIR="${PI_PLUGINS_DIR:-$HOME/.pi-desktop/plugins}"
DEST="$PLUGINS_DIR/installed/$ID"

[ -d "$DEST" ] || { echo "✘ 安装目录不存在：$DEST（请先在 PI-Desktop 里安装 $ID）" >&2; exit 1; }
[ -f "$PKG/manifest.json" ] || { echo "✘ 找不到插件源码：$PKG" >&2; exit 1; }

echo "→ 重建内嵌脚手架"
node "$ROOT/scripts/build-scaffold.js"

VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PKG/manifest.json','utf8')).version)")"

echo "→ 同步 $ID@$VERSION 到 $DEST"
rm -rf "$DEST/renderer" "$DEST/assets"
cp "$PKG/main.js" "$DEST/main.js"
cp "$PKG/manifest.json" "$DEST/manifest.json"
cp "$PKG/README.md" "$DEST/README.md"
cp "$PKG/scaffold.generated.js" "$DEST/scaffold.generated.js"
cp -R "$PKG/renderer" "$DEST/renderer"

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
