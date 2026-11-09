#!/usr/bin/env bash
# 等 PI-Desktop 完全退出后，把插件注册切到正式发布版，并重新启动 App。
#
# 为什么必须等退出：宿主在退出时会用内存里的插件描述回写 plugins/registry.json，
# 运行期改 registry 一定会被覆盖（本机实测过一次）。
#
# 用法（关键：必须用 launchctl 提交，脱离 App 的进程树，否则 App 一退就被杀）：
#   launchctl submit -l gwb.piworkflow.switch -- /bin/bash "$HOME/devStation/pi-workflow/scripts/apply-release-switch.sh"
#
# 日志：~/.pi-desktop/plugins/switch-to-release.log
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/.pi-desktop/plugins/switch-to-release.log"
APP_PATTERN="PI-Desktop.app/Contents/MacOS/PI-Desktop"
MAX_POLLS=720   # 5s × 720 = 最长等 60 分钟

exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') 守护启动，等待 PI-Desktop 退出 ==="

for i in $(seq 1 "$MAX_POLLS"); do
  if ! pgrep -f "$APP_PATTERN" >/dev/null 2>&1; then
    echo "$(date '+%F %T') 检测到 PI-Desktop 已退出（第 $i 次探测）"
    sleep 3   # 给宿主时间把状态落盘
    if bash "$ROOT/scripts/switch-to-release.sh"; then
      echo "$(date '+%F %T') 注册表已切到正式版"
    else
      echo "$(date '+%F %T') ✘ 切换失败，请手动执行 scripts/switch-to-release.sh"
    fi
    sleep 1
    echo "$(date '+%F %T') 重新启动 PI-Desktop"
    open -a "PI-Desktop"
    echo "=== $(date '+%F %T') 完成 ==="
    exit 0
  fi
  sleep 5
done

echo "$(date '+%F %T') 超时未检测到退出（App 仍在运行），未做任何修改"
exit 1
