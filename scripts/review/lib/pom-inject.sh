#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# pom-inject.sh — 评审期临时注入 Maven 插件的「注入 / 回滚」库（支持多模块）
#
# 背景：被评审 app 通常不能在 pom 里常驻 checkstyle/pmd/spotbugs/ArchUnit。
#      评审时临时注入一个 `cr-review` profile，跑完立刻回滚。
#
# 多模块：自动发现仓库内所有 pom.xml（排除 target/），逐个 guard → 备份 → 注入；
#        回滚时逐个恢复并校验 sha256。任一模块注入失败则回滚已注入的，全有或全无。
#
# 安全设计：
#   1. 注入前要求所有 pom 在 git 中干净（任一脏即整体拒绝）
#   2. 每个 pom 备份到 <out>/pom-modules/，并记 sha256
#   3. 只允许改动 pom.xml 与 target/；结束时校验其它文件未变
#   4. 调用方用 trap EXIT/INT/TERM 触发回滚，中断也能恢复
#   5. 回滚后逐个校验 sha256，不一致立刻报错并给人工恢复命令
#   6. 不执行任何 git 写操作（不用 checkout/stash）
#
# 用法：
#   source scripts/review/lib/pom-inject.sh
#   pom_discover && pom_guard_clean && pom_backup "$OUT" && pom_inject
#   pom_restore
# ---------------------------------------------------------------------------

POM_FILE="${POM_FILE:-pom.xml}"
POM_LIST=()
POM_BAK_LIST=()
POM_SHA_LIST=()
POM_INJ_LIST=()
POM_BACKUP_DIR=""
POM_INJECTED=0
POM_MULTI=0

_pom_sha() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else cksum "$1" | awk '{print $1"-"$2}'
  fi
}

# 发现所有 pom（只认 git 跟踪的，排除 target/）
pom_discover() {
  POM_LIST=()
  local f
  while IFS= read -r f; do
    [ -n "$f" ] && POM_LIST+=("$f")
  done < <(git ls-files 2>/dev/null | grep -E '(^|/)pom\.xml$' | grep -v '/target/' | sort -u)
  if [ "${#POM_LIST[@]}" -eq 0 ] && [ -f "$POM_FILE" ]; then
    POM_LIST=("$POM_FILE")
  fi
  POM_MULTI=$([ "${#POM_LIST[@]}" -gt 1 ] && echo 1 || echo 0)
  echo "discover: ${#POM_LIST[@]} 个 pom（${POM_LIST[*]:-无}）"
  [ "${#POM_LIST[@]}" -gt 0 ]
}

# 前置门禁：所有 pom 必须 git 干净
pom_guard_clean() {
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "guard: 非 git 仓库，拒绝注入（无法保证回滚可靠性）" >&2
    return 1
  fi
  [ "${#POM_LIST[@]}" -gt 0 ] || { echo "guard: 未发现 pom" >&2; return 1; }
  local dirty="" f
  for f in "${POM_LIST[@]}"; do
    if [ -n "$(git status --porcelain -- "$f" 2>/dev/null)" ]; then dirty="$dirty $f"; fi
  done
  if [ -n "$dirty" ]; then
    echo "guard: 以下 pom 有未提交改动，拒绝注入（请先提交或暂存）：$dirty" >&2
    return 1
  fi
  git status --porcelain 2>/dev/null | grep -vE '(^.. .*pom\.xml$)|(^.. .*target/)' > "${POM_DIRTY_BEFORE:-/dev/null}" || true
  return 0
}

# 备份全部 pom，记录 sha256
pom_backup() {
  local out="$1"
  [ "${#POM_LIST[@]}" -gt 0 ] || { echo "pom_backup: 未发现 pom" >&2; return 1; }
  POM_BACKUP_DIR="$out/pom-modules"
  mkdir -p "$POM_BACKUP_DIR" || return 1
  POM_BAK_LIST=(); POM_SHA_LIST=(); POM_INJ_LIST=()
  local f bak i=0
  for f in "${POM_LIST[@]}"; do
    [ -f "$f" ] || { echo "pom_backup: 缺失文件 $f" >&2; return 1; }
    i=$((i+1))
    bak="$POM_BACKUP_DIR/$(printf '%02d' "$i")__$(echo "$f" | tr '/' '_').orig"
    cp "$f" "$bak" || return 1
    POM_BAK_LIST+=("$bak")
    POM_SHA_LIST+=("$(_pom_sha "$bak")")
    POM_INJ_LIST+=("0")
    echo "backup: $f → $bak (sha256=${POM_SHA_LIST[$((i-1))]:0:12}…)"
  done
  return 0
}

# 向单个 pom 注入（在最后一个 </project> 前插入）
_pom_inject_one() {
  local target="$1"
  local snippet
  snippet=$(cat <<'XML'
  <!-- BEGIN cr-review profile (temporary, injected by scripts/review/run-l1.sh) -->
  <profiles>
    <profile>
      <id>cr-review</id>
      <properties>
        <cr.archunit.version>1.2.1</cr.archunit.version>
      </properties>
      <dependencies>
        <dependency>
          <groupId>com.tngtech.archunit</groupId>
          <artifactId>archunit-junit5</artifactId>
          <version>${cr.archunit.version}</version>
          <scope>test</scope>
        </dependency>
      </dependencies>
      <build>
        <plugins>
          <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-checkstyle-plugin</artifactId>
            <version>3.3.1</version>
          </plugin>
          <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-pmd-plugin</artifactId>
            <version>3.21.2</version>
          </plugin>
          <plugin>
            <groupId>com.github.spotbugs</groupId>
            <artifactId>spotbugs-maven-plugin</artifactId>
            <version>4.8.3.0</version>
          </plugin>
        </plugins>
      </build>
    </profile>
  </profiles>
  <!-- END cr-review profile -->
XML
)
  if command -v node >/dev/null 2>&1; then
    POM_SNIPPET="$snippet" POM_TARGET="$target" node -e '
      const fs = require("fs");
      const p = process.env.POM_TARGET, s = process.env.POM_SNIPPET;
      const src = fs.readFileSync(p, "utf8");
      const i = src.lastIndexOf("</project>");
      if (i < 0) { console.error("pom_inject: 未找到 </project>: " + p); process.exit(3); }
      fs.writeFileSync(p, src.slice(0, i) + s + "\n" + src.slice(i));
    ' || return 1
  elif command -v python3 >/dev/null 2>&1; then
    POM_SNIPPET="$snippet" POM_TARGET="$target" python3 - <<'PY' || return 1
import os
p = os.environ["POM_TARGET"]
s = os.environ["POM_SNIPPET"]
src = open(p, encoding="utf-8").read()
i = src.rfind("</project>")
if i < 0:
    raise SystemExit("pom_inject: 未找到 </project>: " + p)
open(p, "w", encoding="utf-8").write(src[:i] + s + "\n" + src[i:])
PY
  else
    echo "pom_inject: 需要 node 或 python3 才能安全注入" >&2
    return 2
  fi
  return 0
}

# 注入全部 pom；任一失败即回滚全部，保持全有或全无
pom_inject() {
  [ "${#POM_BAK_LIST[@]}" -gt 0 ] || { echo "pom_inject: 请先 pom_backup" >&2; return 1; }
  local i=0 f
  for f in "${POM_LIST[@]}"; do
    if ! _pom_inject_one "$f"; then
      echo "inject: 注入失败 $f，回滚已注入的模块" >&2
      POM_INJECTED=1
      pom_restore >/dev/null 2>&1 || true
      return 1
    fi
    POM_INJ_LIST[$i]=1
    i=$((i+1))
  done
  POM_INJECTED=1
  echo "inject: 已注入 cr-review profile 到 ${#POM_LIST[@]} 个 pom（跑完自动回滚）"
  return 0
}

# 回滚全部 pom 并逐个校验 sha256
pom_restore() {
  [ "$POM_INJECTED" = "1" ] || return 0
  local rc=0 i=0 f bak now
  for f in "${POM_LIST[@]}"; do
    bak="${POM_BAK_LIST[$i]:-}"
    i=$((i+1))
    if [ -z "$bak" ] || [ ! -f "$bak" ]; then continue; fi
    if ! cp "$bak" "$f"; then
      echo "restore: 恢复失败 $f，请人工执行：cp \"$bak\" \"$f\"" >&2
      rc=1; continue
    fi
    now="$(_pom_sha "$f")"
    if [ "$now" = "${POM_SHA_LIST[$((i-1))]}" ]; then
      echo "restore: $f 已恢复（sha256 一致）"
    else
      echo "restore: $f sha256 不一致（期望 ${POM_SHA_LIST[$((i-1))]:0:12}… 实际 ${now:0:12}…），请人工核对 $bak" >&2
      rc=1
    fi
  done
  [ "$rc" = "0" ] && POM_INJECTED=0
  return $rc
}

# 校验：除 pom.xml 与 target/ 外无改动
pom_verify_tree() {
  local dirty
  dirty=$(git status --porcelain 2>/dev/null | grep -vE '(^.. .*pom\.xml$)|(^.. .*target/)' || true)
  if [ -n "$dirty" ]; then
    echo "verify: 检测到 pom/target 之外的改动（不是注入造成的，请人工确认）：" >&2
    echo "$dirty" >&2
    return 1
  fi
  return 0
}

# 模块清单 JSON（供审计）
pom_modules_json() {
  local i=0 f
  printf '['
  for f in "${POM_LIST[@]}"; do
    i=$((i+1))
    [ "$i" -gt 1 ] && printf ', '
    printf '{"path": "%s", "sha256": "%s", "injected": %s}' \
      "$f" "${POM_SHA_LIST[$((i-1))]:-}" "${POM_INJ_LIST[$((i-1))]:-0}"
  done
  printf ']'
}
