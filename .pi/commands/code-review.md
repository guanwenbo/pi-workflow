---
description: 代码级评审：L1 机械层 + L2 多视角语义评审 + 验证轮，产出 06a-code-review.md；通过后 /cr 才能开始架构师 CR
---

> **EP-05 门禁**：`developing` 期间每次开发完成（含 CR 修复、minor 加固、父 Agent 直接小修）都必须先过本命令，不得以改动小为由跳过。

# /code-review

参数：`REQ-YYYYMMDD-<slug>`（必填）
选项：`--profile lite|std|full`（默认 auto 按改动体量定档）、`--full`（忽略 baseline 存量抑制）、`--incremental <sha>`（只审该 sha 之后的增量）

## 与 /cr 的分工（禁止混淆）

| 命令 | 评审对象 | 判据来源 | 不做什么 |
|---|---|---|---|
| /code-review（本命令） | 代码本身：机械检查 + 语义缺陷 | 工具输出 + 验证轮 + 项目台账 | **不评架构一致性**（那是 /cr 第零阶段） |
| /cr | 架构一致性：实现 vs 03-design、分层、域间调用 | 设计稿 + ARCHITECTURE.md | **不重跑 L1**，直接引用本命令 `cr_gate` 的结论 |

## 前置校验

1. 调 `cr_begin{reqId}`：校验 `00-meta.md` 状态 ∈ {`developing`, `cr-agent`}，产出轮次号与 `reviews/R-NN/plan.json`。`ok=false` 即按其 hint 停止。
   - `cr-confirmed` 及之后 → 提示「请输入 /change <变更描述>」后停止
2. `cr-human`/`cr-confirmed` 下若存在**未过本命令的新改动**（含父 Agent 直接小修）→ 视为回到 `cr-agent`，开聚焦增量轮（自动带 `--incremental`）。
3. **前置跳过**：`cr_begin` 返回 `skip=true`（无改动 / 仅注释与格式 / 同一 sha 已通过）→ 提示用户并结束，**不计 CR 轮次**。

## 执行流程

### 阶段一：L1 机械层

1. 派发**执行子代理**（需 Bash），任务简报：
   - 运行 `scripts/review/run-l1.sh --req <reqId> --round <N> --out requirements/<reqId>/reviews/R-NN/raw`
   - 脚本覆盖：ArchUnit（架构规则测试）、checkstyle、pmd（p3c 规则集 + 死代码规则）、spotbugs、error-prone、semgrep（自有红线）、gitleaks、**`mvn enforcer`（jar 冲突：dependencyConvergence / banDuplicateClasses）**、`dependency:analyze`（未使用声明依赖）、dependency-check、sonar-scanner
   - **零配置优先**：被评审 app 通常不能新增插件/依赖，因此脚本先跑**不需要 app 配置**的项——`git diff`、**`mvn dependency:tree -Dverbose`（maven 内置，jar 冲突的核心手段）**、`mvn dependency:analyze`（内置，未使用声明依赖）、semgrep（自有红线 `rules/semgrep`）、gitleaks
   - **评审期临时注入（默认开，支持多模块）**：自动发现仓库内**所有** `pom.xml`（排除 `target/`），逐个注入 `cr-review` profile（checkstyle/pmd/spotbugs/ArchUnit），跑完**自动回滚并逐模块校验 sha256**。安全约束：任一 pom 有未提交改动即**整体拒绝**（不留半注入）；全局 `trap` 保证中断也回滚；任一模块注入失败会回滚已注入的；审计写 `raw/pom-inject.json`（含 modules 清单）与备份目录 `raw/pom-modules/`。不需要时加 `--no-inject`。
   - **先自检再正式跑**：`--verify-inject` 只验证「注入 → 校验 → 回滚」，不执行 mvn（秒级），适合在真实 app 上先确认 pom 结构（parent/BOM/多模块）吃得消。
   - **仍不用 app 常驻配置**：注入只活在本轮执行期间；`--no-inject` 或 pom 不干净时，相关工具记 skipped（不是 failed），交 L2 自行校验
   - **工具缺失不等于无法评审**：R0–R10 由 L2 评审员读代码自行校验；分层/同层互调优先用 gates 插件 `layer_scan`（纯静态、零配置）——**注入 ArchUnit 只带来库，不带来规则测试**，规则仍要 app 自己写或由 layer_scan 兜底
   - **dependency-check 默认关闭**（NVD 下载可达数百 MB）；需要时 `--with-dependencycheck`
   - 返回 ≤200 字：各工具 成功/失败/跳过 + 产物目录
2. 父 Agent 调 `cr_ingest{reqId, round, diffPath, rawDir}`：归一 → diff 行过滤 → baseline 抑制 → 指纹去重 → 严重度映射
3. 调 `cr_gate{reqId, round}`：
   - `ok=false`（有 blocker，或覆盖缺口超限）→ 派发开发工程师修复，**不进阶段二**（省 Agent 成本），修完重跑阶段一
   - `ok=true` → 进入阶段二

### 阶段二：L2 语义评审（多视角 + 验证轮）

4. **端归属判定（先做这一步，不靠任何参数）**：同一项目内运营端与非运营端并存，派发 **V2** 先判定每处改动属于哪一端，依据入口/调用方/鉴权/页面来源等**可举证**证据，产出 `reviews/R-NN/scope.json`（`{items:[{target,end,basis,confidence}], humanNote}`）。
   - 父 Agent 把清单呈现给用户：**中途可给建议**（写入 `scope.json` 的 `humanNote`，或用 `cr_begin` 的 `endScope` 重跑本轮档位）
   - 判不准的项标 `待确认`，**按非运营端从严**处理，不得凭"看着像后台"放宽
   - 端归属只影响 R4/R9 的宽严，不影响 blocker 是否成立
5. 定档（`plan.json` 已算好改动行数；端归属不参与定档，只在下方做档位修正）：

| 档 | 触发条件 | 视角 | 验证轮 |
|---|---|---|---|
| lite | <100 行 且 单文件 | V1 | 跳过（V1 的 blocker 须人工确认） |
| std | <400 行 | V1 + V2 | blocker/major 全验 |
| full | ≥400 行，或触及入口/资金/状态机/分布式组件 | V1 + V2 + V3 + V4 | blocker/major 全验 |

**强制升级**（不受体量限制）：**只要 diff 触及金额/资产 → 无条件升 full 并启用 V-money**；端归属判为 `批量任务` → 至少 std；**端归属判为 `运营端` 时 full 可降为 std**（不跑 V3/V4），但金额类改动除外。

6. 并行派发视角子代理——**彼此不共享结论，独立产出，由父 Agent 合并**（防锚定）：
   - **V1 · diff-only**：只给 `git diff`，不给额外上下文。找语法/引用/类型错误、必然错结果、边界越界
   - **V2 · 穿透上下文**：改动函数 + 上下游各一层调用 + pom 改动。覆盖 R0–R4、R6–R9 的结构类判断
   - **V3 · 静默失败**：catch 空吞、默认值掩盖错误、降级无日志、异常被上层误认为成功
   - **V4 · 历史与设计**：`git log`/blame + `03-design.md` + 项目 `rules/<module>.md`。找偏离设计承诺、重复实现已有能力、破坏既有调用方
   - **V-money**（升级时启用）：R5 资产与金额 + R8 中的金额单位口径
   - 每个视角：角色 `code-reviewer`，产出 `reviews/R-NN/findings-<Vn>.json`，返回 ≤200 字
7. **验证轮**：汇总去重后，对每条 blocker/major 派 `code-review-validator` 独立复核。validator **只许证伪，不许提新问题**。
   - 确认 → 保留原级别；降级 → 按建议级别；驳回 → 丢弃并记录理由（用于统计假阳性率）
8. 零 open blocker 才可进阶段三；major 可登记待修但须列明，minor 只记录不阻塞。
   - **R6（无用代码）为 major，但未删除即不放行**；删除后必须**重跑阶段一 + 增量阶段二**（删除本身会引入引用问题）
9. **R8 未取证时不判冲突**：项目无台账时，先按 `workflow/SEMANTICS.md`「二、首次评审的初始化」取证建台账，取证结果需用户确认；取证不到只记「未登记」，不得凭空判定既有口径。

### 阶段三：产出与门禁

10. 调 `cr_report{reqId, round}` 生成 `06a-code-review.md`（按 `workflow/templates/06a-code-review.md`，**按轮追加不覆盖**）+ `reviews/issues.json` + SUMMARY ≤5 行
11. 最终 `cr_gate`：
    - `ok=true` → 提示「L1/L2 已通过，请执行 /cr <需求编号>」
    - `ok=false`（仍有 open blocker，或 R6 未删）→ 派发开发工程师修复，本轮 `metrics.rework` +1
12. 每落盘一轮 → `metrics_record{kind:"cr_round"}`；**以同一提交内最高已落盘轮次为准，不是上一值 +1**
13. 通过后回写：本轮新增取值登记进**项目台账**（项目根 `SEMANTICS.md`），并在报告中记「新增语义 N 条 / 未取证 M 条」

## 产出

- `requirements/<reqId>/06a-code-review.md`（按轮追加，不覆盖）
- `requirements/<reqId>/reviews/R-NN/{plan.json, issues.json, findings-V*.json, validation-*.json, raw/}`
- `requirements/<reqId>/reviews/{baseline.sarif, waivers.md}`
- 更新 SUMMARY.md（≤5 行）、`00-meta.md` 的 CR 轮次/返工
- 插件不可用（`cr_*` 工具不存在）时：按本命令与模板手工执行，并在 `06a-code-review.md` 首行声明「插件缺失，走手工兜底」

## 模型分配（控成本，强制显式指定）

| 环节 | 模型 |
|---|---|
| 阶段一 执行子代理（跑脚本，无需判断） | 默认廉价模型 |
| 视角 V1 / V2 / V4 | `custom/Claude-Sonnet-5.5-joybuilder` → 回退 `custom/GPT-6-Sol-joybuilder` |
| 视角 V3、V-money | `custom/GPT-6-Sol-joybuilder` → 回退 `custom/GPT-6-Astra-joybuilder` |
| 验证轮：bug/金额类（R2–R5） | `custom/GPT-6-Sol-joybuilder` |
| 验证轮：规范/证据/语义/死代码类（R6–R10） | `custom/Claude-Sonnet-5.5-joybuilder` |

## 过程纪律（EP-05 / EP-07，强制）

- **豁免必须留痕**：`cr_rule` 的 waive/downgrade 必须带理由 + 期限写入 `waivers.md`；无理由直接拒绝
- **假阳性零容忍**：validator 驳回的条目不得进报告；同一指纹跨轮重复出现必须说明「为何上轮未修」
- **验证轮不得提新问题**：否则退化为二次评审，轮次永不收敛
- **Sonar 覆盖缺口**：连续 2 轮 `sonar: unavailable` → `cr_gate` 返回 ok=false，须用户显式 waive
- **禁止**：不跑工具只看报告、拿 minor 凑数当 blocker、跳过验证轮宣布通过、把举例当项目既有口径
