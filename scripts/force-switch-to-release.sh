#!/usr/bin/env bash
# 一键把 PI-Desktop 的 PI-Workflow Gates 插件从 dev 切到正式发布版：
# 延迟数秒 → 让 App 自己退出 → 打补丁 → 重新打开。
#
# 为什么必须由脚本控制重启：宿主会用内存里的插件描述回写 plugins/registry.json，
# 运行期改的 registry 会在退出时被覆盖（本机实测两次）。
# 为什么要显式 PATH：launchctl 提交的脚本没有登录 shell 的 PATH（实测 node 找不到）。
#
# 提交方式（必须脱离 App 进程树）：
#   launchctl submit -l gwb.piworkflow.switch -- /bin/bash "$HOME/devStation/pi-workflow/scripts/force-switch-to-release.sh"
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/.pi-desktop/plugins/switch-to-release.log"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
DELAY="${SWITCH_DELAY:-6}"   # 延迟，方便先把说明发出去

exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') 自动切换启动（node=$NODE，延迟 ${DELAY}s 后退出 App）==="

cp "$HOME/.pi-desktop/plugins/registry.json" "$HOME/.pi-desktop/plugins/registry.json.pre-force-$(date +%H%M%S)" 2>/dev/null || true
sleep "$DELAY"

echo "$(date '+%F %T') 请求退出 PI-Desktop"
osascript -e 'quit app "PI-Desktop"' >/dev/null 2>&1 || true

for i in $(seq 1 240); do
  pgrep -f "PI-Desktop.app/Contents/MacOS/PI-Desktop" >/dev/null 2>&1 || break
  sleep 0.5
done
if pgrep -f "PI-Desktop.app/Contents/MacOS/PI-Desktop" >/dev/null 2>&1; then
  echo "$(date '+%F %T') ✘ App 未退出，放弃（未做任何修改）"; exit 1
fi
echo "$(date '+%F %T') App 已退出（第 $i 次探测），开始打补丁"
sleep 2

if NODE="$NODE" bash "$ROOT/scripts/switch-to-release.sh"; then
  echo "$(date '+%F %T') ✓ 补丁完成"
else
  echo "$(date '+%F %T') ✘ 补丁失败"; exit 1
fi

sleep 1
echo "$(date '+%F %T') 重新启动 PI-Desktop"
open -a "PI-Desktop"

sleep 25
echo "$(date '+%F %T') 重启后校验："
"$NODE" -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.env.HOME+"/.pi-desktop/plugins/registry.json","utf8"));const l=Array.isArray(r)?r:r.plugins;const e=l.find(p=>p.id==="gwb.pi-workflow-gates");console.log("   ",JSON.stringify({source:e.source,version:e.version,path:e.path}))'
echo "=== $(date '+%F %T') 结束 ==="
