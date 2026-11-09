#!/usr/bin/env bash
# 把 .pi/commands/*.md（工作流命令的权威定义）生成到 .pi/prompts/*.md。
#
# 为什么需要这一步：PI-Desktop 的 `/` 命令面板**不扫描 .pi/commands**，它只读两处提示模板：
#   项目级 <工作区>/.pi/prompts/*.md、用户级 ~/.pi/agent/prompts/*.md
# （见宿主 composerTemplateDirs / loadComposerTemplates，frontmatter 取 description / argument-hint，
#   正文即 prompt，支持 $ARGUMENTS、${1}、${@:-默认值} 等占位）。
# 因此这里生成薄封装：正文只指向权威定义文件，避免两处规则漂移。
#
# 用法：bash scripts/sync-prompts.sh          # 生成 / 更新项目级模板
#      bash scripts/sync-prompts.sh --user   # 额外装到用户级（所有工作区可见）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.pi/commands"
OUT="$ROOT/.pi/prompts"

[ -d "$SRC" ] || { echo "✘ 找不到 $SRC" >&2; exit 1; }
mkdir -p "$OUT"

count=0
for f in "$SRC"/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f" .md)"

  # description 取 frontmatter 的 description 行；缺失则用首行标题兜底
  desc="$(sed -n 's/^description:[[:space:]]*//p' "$f" | head -1)"
  [ -n "$desc" ] || desc="pi-workflow 命令 /$name"

  # argument-hint 取「参数：」行，去掉反引号与括号说明，截断到 60 字
  hint="$(sed -n 's/^参数：[[:space:]]*//p' "$f" | head -1 \
    | sed 's/`//g' | sed 's/（.*$//' | sed 's/[[:space:]]*$//')"
  hint="${hint:0:60}"

  # YAML 双引号转义
  desc_yaml="${desc//\\/\\\\}"; desc_yaml="${desc_yaml//\"/\\\"}"
  hint_yaml="${hint//\\/\\\\}"; hint_yaml="${hint_yaml//\"/\\\"}"

  {
    echo "---"
    echo "description: \"$desc_yaml\""
    [ -n "$hint" ] && echo "argument-hint: \"$hint_yaml\""
    echo "---"
    cat <<BODY
执行 pi-workflow 命令 \`/$name\`。

本次调用参数：\${@:-（未提供）}

执行前必须先读 \`.pi/commands/$name.md\`——它是本命令的权威定义，严格按其中的「前置校验 → 执行流程 → 产出与状态流转」执行，插件工具调用不得省略。
若该文件不存在，说明当前仓尚未接入 pi-workflow：告知用户先执行 \`/req-adopt <本仓绝对路径>\`，然后停止，不要凭猜测执行。
BODY
  } > "$OUT/$name.md"

  count=$((count + 1))
done

echo "✓ 已生成 $count 个命令入口到 .pi/prompts/"

if [ "${1:-}" = "--user" ]; then
  USER_DIR="$HOME/.pi/agent/prompts"
  mkdir -p "$USER_DIR"
  cp "$OUT"/*.md "$USER_DIR/"
  echo "✓ 已同步到用户级 $USER_DIR（所有工作区可见）"
fi
