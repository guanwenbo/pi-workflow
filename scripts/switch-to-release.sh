#!/usr/bin/env bash
# 把 PI-Workflow Gates 从「dev（仓库源码）」切到「正式发布版（.piplug）」。
#
# 为什么需要脚本：宿主在插件加载/卸载事件里会回写 ~/.pi-desktop/plugins/registry.json，
# 如果 app 还在运行，手改的 source/path 可能被它用内存里的旧描述覆盖。
# 因此这里做成幂等：随时可重跑，以 installed/ 下的真实 manifest 为准对齐 registry。
#
# 用法：
#   bash scripts/switch-to-release.sh                 # 对齐 registry 到 installed 副本
#   bash scripts/switch-to-release.sh --from <piplug>  # 先解包指定 .piplug 再对齐
#
# 执行后需要重启 PI-Desktop 才会按新路径加载（插件路径只在启动时解析）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="gwb.pi-workflow-gates"
PLUGINS_DIR="${PI_PLUGINS_DIR:-$HOME/.pi-desktop/plugins}"
DEST="$PLUGINS_DIR/installed/$ID"
REG="$PLUGINS_DIR/registry.json"

if [ "${1:-}" = "--from" ] && [ -n "${2:-}" ]; then
  SRC="$2"
  [ -f "$SRC" ] || { echo "✘ 找不到安装包：$SRC" >&2; exit 1; }
  echo "→ 解包 $SRC → $DEST"
  rm -rf "$DEST"; mkdir -p "$DEST"
  unzip -q "$SRC" -d "$DEST"
fi

[ -f "$DEST/manifest.json" ] || { echo "✘ 安装目录没有 manifest：$DEST" >&2; exit 1; }
VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$DEST/manifest.json','utf8')).version)")"

# 备份 registry（只留最近一份，避免堆垃圾）
[ -f "$REG" ] && cp "$REG" "$REG.bak"

node - "$REG" "$ID" "$DEST" "$VERSION" <<'NODE'
const fs = require("fs");
const [file, id, dest, version] = process.argv.slice(2);
const reg = JSON.parse(fs.readFileSync(file, "utf8"));
const list = Array.isArray(reg) ? reg : (reg.plugins || []);
const hit = list.find(p => p.id === id);
if (!hit) { console.error(`✘ registry.json 里没有 ${id}——请先在 Plugins 页面安装一次`); process.exit(1); }
const before = { source: hit.source, version: hit.version, path: hit.path };
hit.source = "installed";
hit.path = dest;
hit.version = version;
hit.status = "ready";
hit.enabled = true;
hit.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(reg, null, 2) + "\n");
console.log(`→ registry: ${before.source}@${before.version} → installed@${version}`);
console.log(`   path: ${dest}`);
NODE

# 自检：安装目录内容与版本
node -e '
const fs=require("fs"),p=require("path"),d=process.argv[1];
const need=["main.js","manifest.json","renderer/index.html","scaffold.generated.js"];
const miss=need.filter(f=>!fs.existsSync(p.join(d,f)));
if(miss.length){console.error("✘ 安装目录缺少："+miss.join(", "));process.exit(1);}
console.log("✓ 安装目录完整（含内嵌脚手架）");
' "$DEST"

echo "✓ 已切到正式版 $VERSION"
echo "  重启 PI-Desktop 生效（插件路径只在启动时解析）；重启后版本应显示 $VERSION、来源为 installed。"
