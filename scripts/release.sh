#!/usr/bin/env bash
# 发版：校验 → 重建脚手架 → 打包 → 更新 latest.json → 打 tag → 推送 → 建 GitHub Release 并上传 .piplug
#
# 发版规则：每个版本必须有 tag（vX.Y.Z），使用方只安装「tag 对应的 Release 附件」。
# 自动更新靠 latest.json（raw.githubusercontent 可读，无需 token）：
#   插件加载时读取它比对版本，落后就提示；命令「检查插件更新」可下载附件。
#
# 用法：bash scripts/release.sh            # 用 manifest 里的版本发版
#      bash scripts/release.sh --dry-run  # 只跑到打包，不 tag 不推送不建 release
#
# 前置：gh 已登录（gh auth login），否则只能打 tag/推送，Release 需手工建。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="gwb.pi-workflow-gates"
PKG="$ROOT/packages/pi-workflow-gates"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$ROOT"
VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PKG/manifest.json','utf8')).version)")"
TAG="v$VERSION"
ASSET="$PKG/dist/$ID-$VERSION.piplug"
REPO="$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/]+)\.git#\1#')"

echo "→ 版本 $VERSION（tag $TAG，仓库 $REPO）"

# 1) 版本一致性：manifest 与已存在 tag 不能冲突
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "✘ tag $TAG 已存在——请先改 manifest 版本号再发版" >&2
  exit 1
fi

# 2) 工作区干净（避免把未提交内容打进包）
if [ -n "$(git status --porcelain -- . ':!.workflow' ':!*.piplug')" ]; then
  echo "✘ 工作区有未提交改动，请先提交再发版：" >&2
  git status --short -- . ':!.workflow' >&2
  exit 1
fi

# 3) 脚手架必须最新（否则分发包里是旧命令）
node "$ROOT/scripts/build-scaffold.js" --check || node "$ROOT/scripts/build-scaffold.js"

# 4) 回归
node "$PKG/test/smoke.js" >/dev/null
node "$PKG/test/packed-install.js" >/dev/null
echo "✓ 测试通过"

if [ "$DRY" = "1" ]; then
  echo "→ dry-run：跳过打包与发布"
  exit 0
fi

# 5) 打包（用 PI-Desktop 的 PluginPack 语义：目录内除 dist/.git/密钥外全部打入）
echo "→ 请在 PI-Desktop 里对该目录执行 PluginPack，或使用 pi-plugin CLI："
echo "   packages/pi-workflow-gates"
echo "   期望产物：$ASSET"
if [ ! -f "$ASSET" ]; then
  echo "✘ 找不到打包产物 $ASSET（先打包再运行本脚本的发布段）" >&2
  exit 1
fi

# 6) latest.json：自动更新的数据源（raw 可读，无 token）
node - "$PKG/latest.json" "$VERSION" "$TAG" "$REPO" "$ID" <<'NODE'
const fs = require("fs");
const [file, version, tag, repo, id] = process.argv.slice(2);
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const doc = {
  version,
  tag,
  downloadUrl: `https://github.com/${repo}/releases/download/${tag}/${id}-${version}.piplug`,
  publishedAt: new Date().toISOString(),
  notes: prev.version === version ? (prev.notes || []) : [`升级到 ${version}`],
};
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(`→ latest.json -> ${version}`);
NODE

git add "$PKG/latest.json"
git commit -q -m "chore(release): $TAG"
git tag -a "$TAG" -m "PI-Workflow Gates $TAG"
git push origin HEAD --follow-tags
echo "✓ 已打 tag 并推送：$TAG"

# 7) GitHub Release + 附件（使用方只装这里的东西）
if gh auth status >/dev/null 2>&1; then
  # 附件两件：.piplug（安装用）+ latest.json（更新检查的权威源，releases/latest/download/latest.json）
  gh release create "$TAG" "$ASSET" "$PKG/latest.json" \
    --title "PI-Workflow Gates $TAG" \
    --notes "安装：Plugins 页面 → Install package → 选 $(basename "$ASSET")；或让已装旧版的用户执行命令「检查插件更新」。" \
  echo "✓ Release 已创建：https://github.com/$REPO/releases/tag/$TAG"
else
  echo "⚠ gh 未登录，Release 未创建。执行以下命令补建（只需一次登录）：" >&2
  echo "  gh auth login -h github.com" >&2
  echo "  gh release create $TAG \"$ASSET\" \"$PKG/latest.json\" --title \"PI-Workflow Gates $TAG\" --notes \"装 tag $TAG 版本\"" >&2
  exit 2
fi
