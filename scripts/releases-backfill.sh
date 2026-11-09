#!/usr/bin/env bash
# 补齐历史版本的 GitHub Release（每个 tag 一个 Release）。
#
# 规则：
#   - 只给「本地有 .piplug 产物」的版本上传附件；
#   - 更早的 tag（0.9.3 及以前）当时没有留存产物，创建「仅说明、无附件」的 Release，
#     并在正文写明「历史版本，请安装最新 tag」，避免有人误装半成品；
#   - 最新版设 --latest，其余 --latest=false；
#   - 已存在的 Release 跳过（可重复执行）。
#
# 前置：gh auth login -h github.com
# 用法：bash scripts/releases-backfill.sh [--dry-run]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/pi-workflow-gates"
ID="gwb.pi-workflow-gates"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# tag 从新到旧；带 assets=yes 的是本地有产物的
TAGS=(
  "v0.9.5:yes"
  "v0.9.4:yes"
  "v0.9.3:no"
  "v0.9.2:no"
  "v0.9.1:no"
  "v0.9.0:no"
  "v0.8.1:no"
  "v0.8.0:no"
)

if ! gh auth status >/dev/null 2>&1; then
  echo "✘ gh 未登录，无法创建 Release。先执行：gh auth login -h github.com" >&2
  exit 2
fi

LATEST="${TAGS[0]%%:*}"
echo "→ 最新版本：$LATEST"

for entry in "${TAGS[@]}"; do
  tag="${entry%%:*}"
  has_asset="${entry##*:}"
  version="${tag#v}"
  asset="$PKG/dist/$ID-$version.piplug"

  if gh release view "$tag" >/dev/null 2>&1; then
    echo "  跳过 $tag（Release 已存在）"
    continue
  fi

  latest_flag="--latest=false"
  [ "$tag" = "$LATEST" ] && latest_flag="--latest"

  if [ "$has_asset" = "yes" ] && [ -f "$asset" ]; then
    notes="安装：Plugins 页面 → Install package → 选 $(basename "$asset")。
自动更新：已装旧版的用户执行命令「检查 PI-Workflow 插件更新」即可下载本版本。"
    if [ "$DRY" = "1" ]; then
      echo "  [dry-run] 将创建 $tag（带附件 $(basename "$asset")，$latest_flag）"
    else
      if [ "$tag" = "$LATEST" ]; then
        # 最新版额外挂 latest.json：releases/latest/download/latest.json 是更新检查的权威源
        gh release create "$tag" "$asset" "$PKG/latest.json" --title "PI-Workflow Gates $tag" --notes "$notes" $latest_flag
      else
        gh release create "$tag" "$asset" --title "PI-Workflow Gates $tag" --notes "$notes" $latest_flag
      fi
      echo "  ✔ 已创建 $tag（含附件）"
    fi
  else
    notes="历史版本 $tag：当时未留存 .piplug 产物，仅保留 tag 供追溯。
**请安装最新 tag ${LATEST} 的 Release 附件**，或由维护者用该 tag 源码重新打包。"
    if [ "$DRY" = "1" ]; then
      echo "  [dry-run] 将创建 $tag（无附件，历史说明）"
    else
      gh release create "$tag" --title "PI-Workflow Gates $tag（历史版本）" --notes "$notes" $latest_flag
      echo "  ✔ 已创建 $tag（无附件）"
    fi
  fi
done

echo "✓ 完成。查看：gh release list"
