# PI-Code Review

pi-workflow 的**代码级评审判定层插件**。把「轮次开档 / 工具输出归一 / diff 过滤 / 指纹去重 / 门禁判定 / 报告落盘」从 Markdown 软规则下沉为代码物理执行；判断类工作（语义评审、验证）仍由角色 Agent 承担——与 `pi-workflow-gates` 同一分层思路。

## 平台约束（决定了本插件的形态）

| 约束 | 后果 | 本插件的对策 |
|---|---|---|
| 宿主**无进程执行 API** | 插件不能跑 mvn / checkstyle / sonar-scanner | 执行交 `scripts/review/run-l1.sh`（Agent 用 Bash 跑），产物落 `reviews/R-NN/raw/`，本插件只**读产物做判定** |
| `.git/` **一律不可读**（凭据目录） | 插件拿不到 diff | diff 由 Agent 用 `git diff` 落盘到 `reviews/R-NN/diff.patch`，路径经 `diffPath` 传入 |
| 写范围受限 | 只允许写 `requirements/**` | 报告、issues、基线、豁免台账都落在需求档案内；项目根 `SEMANTICS.md` 由父 Agent 回写 |

因此：**插件不执行进程、不访问网络、不改源码、不删文件。**

L1 的"怎么拿到产物"由 [`scripts/review/run-l1.sh`](../../scripts/review/run-l1.sh) 负责，它现在会：
- **零配置**先跑 `git diff`、`mvn dependency:tree`（maven 内置 → jar 冲突）、`dependency:analyze`、semgrep、gitleaks
- 需要插件时**临时注入** `cr-review` profile 到**所有模块** pom（checkstyle/pmd/spotbugs/ArchUnit），跑完回滚并逐模块校验 sha256；可 `--no-inject` 关闭、`--verify-inject` 只验注入链路
- 插件只消费 `raw/` 里的产物与 `status.json` 覆盖矩阵，不参与注入/回滚

## 提供的 Agent 工具

| 工具 | 作用 | 风险 |
|---|---|---|
| `cr_begin` | 校验状态（`developing`/`cr-agent`）、读上轮 open 项、按 `diffStat` 定档（lite/std/full）、同 sha 已通过则跳过、输出 `plan.json`；端归属不靠参数（可由人工用 `endScope` 给建议） | medium |
| `cr_ingest` | 归一 **12 类**工具产物 + diff → issue 模型；diff 行过滤、baseline 抑制、指纹去重、严重度映射、R 项归类，输出 `issues.json` 与覆盖矩阵 | low |
| `cr_rule` | `downgrade` / `waive` 指定 fp；waive 无理由直接拒绝，写入 `waivers.md` 留痕 | medium |
| `cr_gate` | 门禁判定：open blocker、未删除的 R6、sonar 连续不可用 → `ok` | low |
| `cr_report` | 渲染并**追加** `06a-code-review.md` 第 N 轮小节（不覆盖），返回 SUMMARY 行 | medium |
| `cr_baseline` | `freeze`（首次冻结存量）/ `update`（增量合并）/ `status` | medium |
| `cr_profile` | 改动画像：src/test 文件数、无测试覆盖清单、blocker 密度、覆盖缺口、人工优先看什么 | low |

## 数据流

```
Agent: git diff > reviews/R-NN/diff.patch
Agent: scripts/review/run-l1.sh → reviews/R-NN/raw/{*.sarif,*.xml,sonar.json,enforcer.txt,status.json}
   ↓
cr_begin → cr_ingest → cr_gate → (L2 视角 Agent + 验证官) → cr_gate → cr_report
```

## 判定口径（实现细节，与 workflow 文档一致）

- **定档**：`<100 行且单文件` → lite；`<400 行` → std；其余 full；**触及金额 → 强制 full + V-money**；端归属判为 `批量任务` → 至少 std；端归属判为 `运营端` 时 full 可降 std。未传 `diffStat` 时按 std 并回告。
- **diff 过滤**：只保留落在本次 diff 新增行上的问题；文件不在 diff 内的整条丢弃，计数进 `filtered.droppedNotInDiff`。
- **指纹**：`fp = fnv1a(R 项 | 文件 | 归一化 message)`，8 位十六进制。同一 fp 合并为一条并累积 `occurrences`，因此**行号漂移不会产生"新问题"**；跨轮同 fp 保留上一轮 `status`。
- **严重度映射**：内置默认表，可被工作区 `rules/severity.json` 覆盖（`{工具: {原始级别: blocker|major|minor}}` 或 `{工具: "blocker"}`）。
- **R 项归类**（ruleId 启发式，宁可归粗不归错）：PMD/p3c/Checkstyle 的 `Unused*`/`DeadCode`/`EmptyBlock` → `R6`，其余 → `R10`；SpotBugs `URF_/UUF_/DLS_DEAD/UPM_` → `R6`，安全类 → `R-SEC`，其余 → `R1`；ArchUnit 的子域/同层规则 → `R3`，其余 → `R2`；Semgrep/gitleaks → `R-SEC`；**`dependency_tree`（jar 冲突：`omitted for conflict` → blocker、同名多版本 → major）**/enforcer/dependency-check/dependency:analyze → `R0`；Sonar 漏洞类 → `R-SEC`，其余 → `R10`。
- **R6 级别下限**：凡归入 `R6` 的条目，级别不低于 `major`（工具映射只作线索，不允许被降为 minor）——对应 `code-reviewer.md` 的「R6 判定即必须删除」。
- **diff 过滤只对行锚定问题生效**：`line > 0` 才按新增行裁剪；`pom.xml` 的 enforcer/dependency:analyze、ArchUnit 规则、Sonar 质量门禁这类无行号结论不受 diff 范围限制（否则会被静默丢掉）。
- **覆盖矩阵**：12 个工具逐一记 `passed / failed / skipped / unavailable / missing`；`run-l1.sh` 可写 `raw/status.json` 显式声明（优先于自动推断）。
- **sonar 连续不可用**：`state.json` 累计 streak，`>=2` 时 `cr_gate` 直接拒放行（须用户显式 waive）。
- **R6 闭环**：`cr_gate` 对未删除的 `R6` 条目同样拒放行，删除后须重跑 L1。

## 产出

```
requirements/<reqId>/
  06a-code-review.md          # cr_report 渲染，按轮追加
  reviews/
    state.json                # 轮次 / lastSha / sonar streak / lastGateOk
    baseline.json             # 存量指纹基线
    baseline-log.md           # 基线变更台账
    waivers.md                # 豁免台账（时间/轮次/fp/级别/理由/期限）
    R-NN/{plan.json, issues.json, diff.patch, raw/}
```

## 与 gates 插件的分工

- `gwb.pi-workflow-gates`：建档、状态机、账本（`00-meta.md` 的 status/metrics）、`layer_scan`
- `gwb.pi-code-review`：代码级评审的判定与账本（`reviews/**` 与 `06a-code-review.md`）

两者都遵循同一原则：**机械可判的部分物理执行，判断类部分留给角色 Agent。**

## 安装

- 开发模式：在 pi-workflow 工作区内打开本目录即热加载
- 其他项目：复制到 `~/.pi-desktop/plugins/installed/gwb.pi-code-review/` 并在 `registry.json` 注册，或用 PluginPack 打包安装

## 未做（明确的边界）

- 不解析 JUnit XML 里的 ArchUnit 明细结构（只认文本里的 `was violated` 行）
- 不做跨文件语义推导（那是 L2 视角 Agent 的活）
- 不写 `00-meta.md`（状态与 metrics 归 gates 插件）
