#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-l1.sh — 代码级评审 L1 机械层执行器（pi-workflow /code-review 阶段一）
#
# 职责（插件不做的部分）：
#   1. 落盘 unified diff  → <out>/../diff.patch
#   2. 依次跑 ArchUnit / checkstyle / pmd(p3c+死代码) / spotbugs / error-prone /
#      semgrep / gitleaks / mvn enforcer(jar 冲突) / dependency:analyze /
#      dependency-check / sonar-scanner
#   3. 把每个工具的原始产物写进 --out，并产出 status.json 供 cr_ingest 读
#
# 设计约束：
#   - 单个工具失败绝不中断整体（评审需要"覆盖缺口"而不是"脚本崩了"）
#   - 没有的工具/插件一律记 skipped/unavailable，不报错
#   - 只读源码，不修改任何文件；产物只写 --out 与 diff 路径
#
# 用法：
#   scripts/review/run-l1.sh --req REQ-20260101-demo --round 1
#   scripts/review/run-l1.sh --req ... --round 1 --base origin/main
#   scripts/review/run-l1.sh --req ... --round 1 --incremental <sha>
#   scripts/review/run-l1.sh --req ... --round 1 --incremental <sha>
#   scripts/review/run-l1.sh --req ... --round 1 --verify-inject   # 只验证注入/回滚，不跑 mvn
#
# 其他参数：
#   --no-inject              不临时注入 cr-review profile（重工具全部 skipped）
#   --with-dependencycheck   开启 OWASP dependency-check（默认关：NVD 下载可达数百 MB）
#   --timeout <秒>           单个工具的超时上限（默认 900；macOS 无 timeout 时用看门狗兜底）
#   --dry-run                只打印将要执行的命令，不写任何产物
# ---------------------------------------------------------------------------
set -uo pipefail

REQ=""
ROUND=""
OUT=""
BASE=""
INCREMENTAL=""
INJECT=1
VERIFY_INJECT=0
WITH_DEPCHECK=0
DRY_RUN=0
TIMEOUT_SEC=900

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --req) REQ="${2:-}"; shift 2 ;;
    --round) ROUND="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --incremental) INCREMENTAL="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SEC="${2:-900}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-inject) INJECT=0; shift ;;
    --with-dependencycheck) WITH_DEPCHECK=1; shift ;;
    --verify-inject) VERIFY_INJECT=1; shift ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

if [ -z "$REQ" ] || [ -z "$ROUND" ]; then
  echo "缺少必填参数：--req / --round（--help 查看用法）" >&2
  exit 2
fi

ROUND2=$(printf "%02d" "$ROUND" 2>/dev/null || echo "$ROUND")
REVIEW_DIR="requirements/$REQ/reviews/R-$ROUND2"
[ -z "$OUT" ] && OUT="$REVIEW_DIR/raw"
DIFF_PATH="$REVIEW_DIR/diff.patch"

# ---------- 小工具 ----------

say() { printf '%s\n' "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }

# 脚本自身目录（lib 与本脚本同仓；被评审 app 是另一个仓库，不能用相对当前目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
plugin_declared() { grep -qs "$1" pom.xml 2>/dev/null; }

# 带超时的执行（macOS 无 timeout 时降级为直接跑）
# 带超时的执行：优先 timeout/gtimeout；macOS 自带两者都没有时用「后台 + 看门狗」兜底，
# 否则 mvn 首次下载插件会无限期挂住（实测会超过工具的分钟级超时预算）。
run_cmd() {
  if [ "$DRY_RUN" = "1" ]; then
    say "[dry-run] $*"
    return 127
  fi
  if has timeout; then timeout "$TIMEOUT_SEC" "$@"; return $?; fi
  if has gtimeout; then gtimeout "$TIMEOUT_SEC" "$@"; return $?; fi
  "$@" &
  local pid=$!
  ( sleep "$TIMEOUT_SEC"; kill -TERM "$pid" 2>/dev/null ) &
  local wd=$!
  wait "$pid"; local rc=$?
  kill -TERM "$wd" 2>/dev/null || true
  return $rc
}
# bash 3.2（macOS 自带）不支持关联数组，改为「前缀普通变量 + eval 间接访问」
mark() { eval "STATE_$1=\"\$2\""; eval "NOTE_$1=\"\${3:-}\""; }
st()   { eval "printf '%s' \"\${STATE_$1:-missing}\""; }
nt()   { eval "printf '%s' \"\${NOTE_$1:-}\""; }

TOOLS="dependency_tree archunit checkstyle pmd spotbugs errorprone semgrep gitleaks enforcer dependency_analyze dependencycheck sonar"

# ---------- 0. 准备 ----------

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  say "错误：当前目录不是 git 仓库，无法生成 diff" >&2
  exit 3
fi
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT" || exit 3

if [ "$DRY_RUN" != "1" ]; then
  mkdir -p "$OUT" "$(dirname "$DIFF_PATH")"
fi
say "== 仓库：$REPO_ROOT"
say "== 产物目录：$OUT"

# ---------- 1. diff ----------

if [ -n "$INCREMENTAL" ]; then
  DIFF_BASE="$INCREMENTAL"
else
  if [ -n "$BASE" ]; then
    DIFF_BASE="$BASE"
  else
    DIFF_BASE=""
    for cand in origin/main origin/master main master; do
      if git rev-parse --verify -q "$cand" >/dev/null 2>&1; then
        DIFF_BASE=$(git merge-base HEAD "$cand" 2>/dev/null || echo "$cand")
        break
      fi
    done
    [ -z "$DIFF_BASE" ] && DIFF_BASE=$(git rev-parse -q --verify HEAD~1 2>/dev/null || echo "")
  fi
fi

# 用「工作区 vs 基线」而非 BASE..HEAD：本地开发常常还没提交，..HEAD 会把未提交改动漏掉
DIFF_RANGE="${DIFF_BASE:-HEAD}"
if [ "$DRY_RUN" = "1" ]; then
  say "[dry-run] git diff --no-color --unified=3 $DIFF_RANGE > $DIFF_PATH"
else
  git diff --no-color --unified=3 "$DIFF_RANGE" > "$DIFF_PATH" 2>/dev/null || : > "$DIFF_PATH"
fi
if [ -n "$DIFF_BASE" ]; then
  say "== diff：工作区 vs $DIFF_RANGE → $DIFF_PATH"
else
  say "== diff：无上游基线，退化为 工作区 vs HEAD → $DIFF_PATH"
fi

STAT=$(git diff --shortstat "${DIFF_BASE:-HEAD}" 2>/dev/null | tr -d '\n' || true)
say "== 体量：${STAT:-未知}（把 files/additions/deletions 传给 cr_begin 可自动定档）"

# ---------- 2. 构建工具探测 ----------

BUILD="none"
if [ -f "pom.xml" ]; then BUILD="maven"
elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then BUILD="gradle"
elif [ -f "package.json" ]; then BUILD="npm"
elif [ -f "go.mod" ]; then BUILD="go"
fi
say "== 构建：$BUILD"

MVN_PREFIX=""
if [ "$BUILD" = "maven" ]; then
  if [ -f "./mvnw" ]; then MVN_PREFIX="./mvnw"; elif has mvn; then MVN_PREFIX="mvn"; fi
fi

# ---------- 2.5 临时注入 cr-review profile（评审后自动回滚） ----------
# 目的：app 不能常驻 checkstyle/pmd/spotbugs/ArchUnit，评审期临时注入、跑完回滚。
# 安全靠 pom-inject.sh 的 guard（pom 必须 git 干净）+ 备份 sha256 + trap + 回滚校验。
MVN_PROFILE=""
ARCHUNIT_INJECTED=0

# 统一清理：回滚 pom + 落审计记录（trap 与正常结束都走这里，保证中断也有记录）
pom_cleanup() {
  command -v pom_restore >/dev/null 2>&1 || return 0
  local rc=0
  pom_restore || rc=1
  if command -v pom_modules_json >/dev/null 2>&1 && [ -n "${OUT:-}" ]; then
    { printf '{\n  "restored": %s,\n  "profile": "cr-review",\n  "mavenProfileArg": "%s",\n  "modules": %s\n}\n' \
        "$([ "$rc" = "0" ] && echo true || echo false)" "${MVN_PROFILE:-}" "$(pom_modules_json)"; } \
      > "$OUT/pom-inject.json" 2>/dev/null || true
  fi
  return $rc
}

if [ "$BUILD" = "maven" ] && [ "$INJECT" = "1" ] && [ "$DRY_RUN" != "1" ]; then
  # lib 在本工作流仓库里，不能按被评审 app 仓库的相对路径找
  LIB_POM="$SCRIPT_DIR/lib/pom-inject.sh"
  if [ -f "$LIB_POM" ]; then
    POM_DIRTY_BEFORE="$OUT/dirty-before.txt"
    # shellcheck disable=SC1090
    . "$LIB_POM"
    if pom_discover && pom_guard_clean && pom_backup "$OUT" && pom_inject; then
      MVN_PROFILE="-Pcr-review"
      ARCHUNIT_INJECTED=1
      trap 'pom_cleanup' EXIT INT TERM
      say "== 已临时注入 cr-review profile（跑完自动回滚；--no-inject 可关闭）"
    else
      say "== 跳过注入（见上方 guard 原因）：重工具记 skipped，交 L2 Agent 自行校验"
    fi
  else
    say "== 未找到 $LIB_POM，跳过注入"
  fi
fi
# ---------- 2.6 自检模式（--verify-inject）：只验证注入/回滚链路，不跑 mvn ----------
if [ "$VERIFY_INJECT" = "1" ]; then
  say ""
  say "== 自检模式：只验证「注入 → 校验 → 回滚」，不执行任何 mvn 目标"
  V_FAIL=0
  if ! command -v pom_inject >/dev/null 2>&1; then
    say "!! 未加载 pom-inject.sh（或因 guard 未通过而跳过）：无法自检"
    exit 1
  fi
  if [ "$POM_INJECTED" != "1" ]; then
    say "!! 注入未发生（多半是 guard 拒绝：pom 有未提交改动 / 非 git 仓库）"
    say "   处理：先提交或暂存 pom 改动，再重跑本自检"
    exit 1
  fi
  for f in "${POM_LIST[@]}"; do
    grep -qs "<id>cr-review</id>" "$f" || { say "!! $f 未注入 cr-review"; V_FAIL=1; }
    grep -qs "archunit-junit5" "$f" || { say "!! $f 未注入 ArchUnit"; V_FAIL=1; }
    if command -v python3 >/dev/null 2>&1; then
      python3 -c "import xml.dom.minidom;xml.dom.minidom.parse('$f')" 2>/dev/null \
        || { say "!! $f 注入后 XML 非法"; V_FAIL=1; }
    fi
  done
  [ "$V_FAIL" = "0" ] && say "ok - cr-review 已注入 ${#POM_LIST[@]} 个 pom，且注入后均为合法 XML"
  if pom_restore; then say "ok - 已回滚（sha256 逐模块校验一致）"; else say "!! 回滚后 sha256 不一致"; V_FAIL=1; fi
  for f in "${POM_LIST[@]}"; do
    grep -qs "cr-review" "$f" && { say "!! $f 回滚后仍残留 cr-review"; V_FAIL=1; }
    git diff --quiet -- "$f" 2>/dev/null || { say "!! $f git 视角仍有改动"; V_FAIL=1; }
  done
  [ "$V_FAIL" = "0" ] && say "ok - 回滚后无残留，${#POM_LIST[@]} 个 pom 在 git 视角均无改动"
  printf '{\n  "mode": "verify-inject",\n  "result": "%s",\n  "at": "%s",\n  "modules": %s\n}\n' \
    "$([ "$V_FAIL" = "0" ] && echo pass || echo fail)" "$(date '+%Y-%m-%d %H:%M')" \
    "$(pom_modules_json)" > "$OUT/inject-verify.json" 2>/dev/null || true
  say ""
  say "== 自检记录：$OUT/inject-verify.json"
  [ "$V_FAIL" = "0" ] && { say "== 结论：注入/回滚链路可用，可以正式跑 ---" ; exit 0; }
  say "== 结论：自检未通过，请先修好再正式跑" >&2
  exit 1
fi

# ---------- 3. 各工具 ----------

run_archunit() {
  if [ -z "$MVN_PREFIX" ]; then mark archunit skipped "非 maven 工程"; return; fi
  # 未注入且 app 自己也没引 ArchUnit 时才跳过；注入场景下 ArchUnit 已由 cr-review profile 提供
  if [ "${ARCHUNIT_INJECTED:-0}" != "1" ] && ! grep -rqs "com.tngtech.archunit" pom.xml */pom.xml 2>/dev/null; then
    mark archunit skipped "app 未引入 ArchUnit，交 L2 Agent + layer_scan 校验"; return
  fi
  # 没有 ArchUnit 规则测试就没有可执行的用例，跑 mvn test 只会得到误导性的 failed
  if ! grep -rqs "archunit" --include=*.java . 2>/dev/null; then
    mark archunit skipped "app 无 ArchUnit 规则测试：交 L2 读代码判定 R2/R3"; return
  fi
  local log="$OUT/archunit.txt"
  run_cmd $MVN_PREFIX $MVN_PROFILE -q -B -DfailIfNoTests=false -Dtest='*Architecture*Test,*Arch*Test' test > "$log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark archunit skipped "dry-run"; return; fi
  if [ $rc -eq 0 ]; then mark archunit passed ""; else mark archunit failed "exit=$rc（见 archunit.txt）"; fi
}

run_checkstyle() {
  if [ -z "$MVN_PREFIX" ]; then mark checkstyle skipped "非 maven 工程"; return; fi
  if [ "$ARCHUNIT_INJECTED" != "1" ] && ! plugin_declared "maven-checkstyle-plugin"; then
    mark checkstyle skipped "app 未配置 checkstyle 插件：交 L2 Agent（R10）自行校验"; return
  fi
  run_cmd $MVN_PREFIX $MVN_PROFILE -q -B checkstyle:checkstyle \
    -DoutputFile="$OUT/checkstyle.xml" > "$OUT/checkstyle.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark checkstyle skipped "dry-run"; return; fi
  if [ ! -f "$OUT/checkstyle.xml" ] && [ -f "target/checkstyle-result.xml" ]; then cp "target/checkstyle-result.xml" "$OUT/checkstyle.xml"; fi
  if [ -f "$OUT/checkstyle.xml" ]; then mark checkstyle passed ""
  elif [ $rc -eq 0 ]; then mark checkstyle skipped "插件未产出报告"
  else mark checkstyle failed "exit=$rc（见 checkstyle.log）"; fi
}

run_pmd() {
  if [ -z "$MVN_PREFIX" ]; then mark pmd skipped "非 maven 工程"; return; fi
  if [ "$ARCHUNIT_INJECTED" != "1" ] && ! plugin_declared "maven-pmd-plugin"; then
    mark pmd skipped "app 未配置 pmd 插件：交 L2 Agent（R6/R10）自行校验"; return
  fi
  run_cmd $MVN_PREFIX $MVN_PROFILE -q -B pmd:pmd -DoutputDirectory="$OUT" -DfailurePriority=5 > "$OUT/pmd.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark pmd skipped "dry-run"; return; fi
  if [ ! -f "$OUT/pmd.xml" ] && [ -f "target/pmd.xml" ]; then cp "target/pmd.xml" "$OUT/pmd.xml"; fi
  if [ -f "$OUT/pmd.xml" ]; then mark pmd passed ""
  elif [ $rc -eq 0 ]; then mark pmd skipped "插件未产出报告"
  else mark pmd failed "exit=$rc（见 pmd.log）"; fi
}

run_spotbugs() {
  if [ -z "$MVN_PREFIX" ]; then mark spotbugs skipped "非 maven 工程"; return; fi
  if [ "$ARCHUNIT_INJECTED" != "1" ] && ! plugin_declared "spotbugs-maven-plugin"; then
    mark spotbugs skipped "app 未配置 spotbugs 插件：交 L2 Agent（R1/R6）自行校验"; return
  fi
  run_cmd $MVN_PREFIX $MVN_PROFILE -q -B spotbugs:spotbugs -Dspotbugs.outputDirectory="$OUT" > "$OUT/spotbugs.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark spotbugs skipped "dry-run"; return; fi
  # 报告默认落在 target/，先回收再看 $OUT
  if [ ! -f "$OUT/spotbugsXml.xml" ] && [ -f "target/spotbugsXml.xml" ]; then cp "target/spotbugsXml.xml" "$OUT/spotbugsXml.xml"; fi
  if [ -f "$OUT/spotbugsXml.xml" ]; then cp "$OUT/spotbugsXml.xml" "$OUT/spotbugs.xml"; mark spotbugs passed ""
  elif [ $rc -eq 0 ]; then mark spotbugs skipped "插件未产出报告"
  else mark spotbugs failed "exit=$rc（见 spotbugs.log）"; fi
}

run_errorprone() {
  if [ -z "$MVN_PREFIX" ]; then mark errorprone skipped "非 maven 工程"; return; fi
  run_cmd $MVN_PREFIX $MVN_PROFILE -q -B -DskipTests compile > "$OUT/errorprone.txt" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark errorprone skipped "dry-run"; return; fi
  if [ $rc -eq 0 ]; then mark errorprone passed ""
  else mark errorprone failed "编译未通过 exit=$rc（见 errorprone.txt）"; fi
}

# 零配置的核心能力：maven-dependency-plugin 是 maven 内置插件，不需要 app 在 pom 里配置。
# 这是「jar 包冲突」唯一可落地到所有 app 的检测方式。
run_dep_tree() {
  if [ -z "$MVN_PREFIX" ]; then mark dependency_tree skipped "非 maven 工程"; return; fi
  run_cmd $MVN_PREFIX -q -B dependency:tree -Dverbose \
    -DoutputFile="$OUT/dependency-tree.txt" > "$OUT/dependency-tree.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark dependency_tree skipped "dry-run"; return; fi
  if [ -s "$OUT/dependency-tree.txt" ]; then
    mark dependency_tree passed ""
  elif [ $rc -eq 0 ]; then
    mark dependency_tree skipped "未产出依赖树"
  else
    mark dependency_tree failed "exit=$rc（见 dependency-tree.log）"
  fi
}
run_enforcer() {
  if [ -z "$MVN_PREFIX" ]; then mark enforcer skipped "非 maven 工程"; return; fi
  run_cmd $MVN_PREFIX -q -B enforcer:enforce -Denforcer.fail=false > "$OUT/enforcer.txt" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark enforcer skipped "dry-run"; return; fi
  if [ -s "$OUT/enforcer.txt" ] && grep -qiE "Dependency convergence error|Found Banned Dependency|Require upper bound" "$OUT/enforcer.txt"; then
    mark enforcer failed "存在 jar 冲突/收敛失败（见 enforcer.txt）"
  elif [ $rc -eq 0 ]; then mark enforcer passed ""
  else mark enforcer skipped "未配置 enforcer 规则或执行失败 exit=$rc"; fi
}

run_dep_analyze() {
  if [ -z "$MVN_PREFIX" ]; then mark dependency_analyze skipped "非 maven 工程"; return; fi
  run_cmd $MVN_PREFIX -q -B dependency:analyze > "$OUT/dependency-analyze.txt" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark dependency_analyze skipped "dry-run"; return; fi
  if [ $rc -eq 0 ]; then mark dependency_analyze passed ""; else mark dependency_analyze failed "exit=$rc"; fi
}

run_semgrep() {
  if ! has semgrep; then mark semgrep unavailable "未安装 semgrep"; return; fi
  local cfg="rules/semgrep"
  if [ ! -d "$cfg" ]; then mark semgrep skipped "未配置 rules/semgrep"; return; fi
  run_cmd semgrep --sarif --output "$OUT/semgrep.sarif" --config "$cfg" --error . > "$OUT/semgrep.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark semgrep skipped "dry-run"; return; fi
  if [ -f "$OUT/semgrep.sarif" ]; then mark semgrep passed ""; else mark semgrep failed "exit=$rc（见 semgrep.log）"; fi
}

run_gitleaks() {
  if ! has gitleaks; then mark gitleaks unavailable "未安装 gitleaks"; return; fi
  run_cmd gitleaks detect --no-git --redact --source . \
    --report-format sarif --report-path "$OUT/gitleaks.sarif" > "$OUT/gitleaks.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark gitleaks skipped "dry-run"; return; fi
  # gitleaks 发现泄漏时 exit=1，报告仍是有效产物
  if [ -f "$OUT/gitleaks.sarif" ]; then mark gitleaks passed ""; else mark gitleaks failed "exit=$rc（见 gitleaks.log）"; fi
}

run_dependencycheck() {
  if [ "$WITH_DEPCHECK" != "1" ]; then
    mark dependencycheck skipped "默认关闭（NVD 下载可达数百 MB）；需要时加 --with-dependencycheck"
    return
  fi
  if [ -z "$MVN_PREFIX" ]; then mark dependencycheck skipped "非 maven 工程"; return; fi
  run_cmd $MVN_PREFIX -q -B org.owasp:dependency-check-maven:check \
    -DfailBuildOnCVSS=11 -Dformat=JSON -DoutputDirectory="$OUT" > "$OUT/dependencycheck.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark dependencycheck skipped "dry-run"; return; fi
  if ls "$OUT"/dependency-check-report.json >/dev/null 2>&1; then
    cp "$OUT"/dependency-check-report.json "$OUT/dependencycheck.json"; mark dependencycheck passed ""
  elif [ $rc -eq 0 ]; then mark dependencycheck skipped "未产出报告"
  else mark dependencycheck failed "exit=$rc（见 dependencycheck.log）"; fi
}

run_sonar() {
  if ! has sonar-scanner; then mark sonar unavailable "未安装 sonar-scanner"; return; fi
  if [ -z "${SONAR_HOST_URL:-}" ]; then mark sonar unavailable "未设置 SONAR_HOST_URL"; return; fi
  run_cmd sonar-scanner -Dsonar.host.url="$SONAR_HOST_URL" \
    ${SONAR_TOKEN:+-Dsonar.token="$SONAR_TOKEN"} \
    -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=300 > "$OUT/sonar.log" 2>&1
  local rc=$?
  if [ "$DRY_RUN" = "1" ]; then mark sonar skipped "dry-run"; return; fi
  local gate="UNKNOWN"
  if has curl && [ -n "${SONAR_TOKEN:-}" ]; then
    local proj="${SONAR_PROJECT_KEY:-}"
    if [ -n "$proj" ]; then
      local body
      body=$(curl -s -u "$SONAR_TOKEN:" "$SONAR_HOST_URL/api/qualitygates/project_status?projectKey=$proj" 2>/dev/null || true)
      printf '{"qualityGate":%s,"issues":[]}\n' "$body" > "$OUT/sonar.json" 2>/dev/null || true
      gate=$(printf '%s' "$body" | grep -o '"status":"[A-Z]*"' | head -1 | cut -d'"' -f4)
    fi
  fi
  if [ $rc -eq 0 ]; then mark sonar passed "quality gate=${gate:-UNKNOWN}"
  else mark sonar unavailable "scanner exit=$rc（见 sonar.log）"; fi
}

run_dep_tree;       say "   dependency_tree     $(st dependency_tree)   ← 零配置（maven 内置插件）"
run_enforcer;       say "   enforcer            $(st enforcer)"
run_dep_analyze;    say "   dependency_analyze  $(st dependency_analyze)"
run_gitleaks;       say "   gitleaks            $(st gitleaks)"
run_semgrep;        say "   semgrep             $(st semgrep)"
run_errorprone;     say "   errorprone          $(st errorprone)   ← 需 app 配 ErrorProne"
run_checkstyle;     say "   checkstyle          $(st checkstyle)   ← 需 app 配插件"
run_pmd;            say "   pmd                 $(st pmd)   ← 需 app 配插件"
run_spotbugs;       say "   spotbugs            $(st spotbugs)   ← 需 app 配插件"
run_archunit;       say "   archunit            $(st archunit)   ← 需 app 配依赖；无配置时用 layer_scan + L2"
run_dependencycheck; say "   dependencycheck    $(st dependencycheck)   ← 需联网下载 NVD"
run_sonar;          say "   sonar               $(st sonar)   ← 需 scanner + server"

# ---------- 4. status.json（cr_ingest 优先读它） ----------

json_escape() { printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

write_status() {
  local first=1
  {
    printf '{\n'
    for t in $TOOLS; do
      local s n
      s=$(st "$t")
      n=$(nt "$t")
      [ $first -eq 1 ] || printf ',\n'
      first=0
      printf '  "%s": { "state": "%s", "note": "%s" }' "$t" "$s" "$(json_escape "$n")"
    done
    printf '\n}\n'
  } > "$OUT/status.json"
}

if [ "$DRY_RUN" = "1" ]; then
  say ""
  say "== dry-run：未写 status.json，未生成任何产物"
  exit 0
fi


pom_cleanup || RESTORE_RC=1
if [ "${RESTORE_RC:-0}" != "0" ]; then
  say ""
  say "!! pom 回滚校验失败：请按 raw/pom-inject.json 的 modules[].path 对应 raw/pom-modules/ 下的备份人工恢复"
fi
if ! pom_verify_tree; then
  say "!! 除 pom/target 外检测到改动，请确认是否为本轮修复所致（脚本不修改源码）"
fi

say ""
say "== 注入/回滚记录：$OUT/pom-inject.json"
write_status
say ""
say "== 覆盖矩阵已写入：$OUT/status.json"
say "== diff：$DIFF_PATH"
say ""
say "下一步（父 Agent）：cr_ingest { reqId: \"$REQ\", round: $ROUND, diffPath: \"$DIFF_PATH\", rawDir: \"$OUT\" }"
exit 0
