# 企业级需求承接工作流（WORKFLOW.md）

> 多角色 Agent 总控版。本文档是整套工作流的总说明与速查表。

## 一、这是什么

一套运行在 PI-Desktop 上的企业级应用需求承接工作流：**父 Agent 总控 + 12 个角色 Agent**，覆盖需求从承接到归档复盘的全生命周期。纯 Markdown 配置，无需安装，进 Git 版本管理。

## 二、核心机制

- **需求档案**：每个需求一个目录 `requirements/REQ-YYYYMMDD-<slug>/`，全生命周期文档都在里面
- **状态机**：`00-meta.md` 记录状态，命令间校验门禁，防止跳步
- **多角色派发**：父 Agent 派发任务简报 → 角色 Agent（独立上下文子代理）执行 → 返回 ≤200 字摘要。角色间零通信，信息只经档案文件中转
- **自我进化**：每个需求复盘时提取流程优化提案（EVOLUTION.md），沉淀个人编码习惯（PROFILE.md），经用户确认后生效

## 三、状态机

```
draft → clarifying → clarified → designing → reviewed → confirmed → planned
→ developing → cr-agent → cr-human → cr-confirmed
→ testing → ready-release → released → archived

blocked：任意阶段可挂起（须记录原因）
change-requested：变更流程，审批通过后回流到对应阶段
```

## 三之二、体量分级（决定产出与门禁）

`/req-new` 时定级，写入 `00-meta.md` 的 `tier`。级别决定「必须产出什么、能走哪些状态、几道人工闸」；**越级/降级只走 `/change`**。

| 级别 | 场景 | 必须产出 | 人工闸 | 状态路径 |
|---|---|---|---|---|
| T0 Bug修复 | 行为纠错，不新增能力 | 00-meta、01-intake（含根因+回归用例）、证据、SUMMARY | 1（修复方案+回归确认） | draft→developing→cr-agent→cr-human→cr-confirmed→archived |
| T1 小型需求 | 单仓、无新表/新对外接口、≲500 行 | + 02-clarification（AC 带名）、05-tasks、证据 | 1（AC 确认） | draft→clarifying→clarified→developing→cr*→testing→archived |
| T2 中型需求 | 单仓、有新接口/新表/跨模块 | 现有全量（含 03-design、08-test-plan、04-review、09-release、11-retro） | 2（方案复审、CR 复验） | 主干 15 态 |
| T3 大型需求 | 跨项目、跨域、需派生 | T2 全部 + derive 简报 + 依赖登记 | 2 + 派生审批 | 主干 15 态 |
| T4 新项目 | 新工程/新应用 | T3 + 工程宪法 + 活 specs 初始化，再拆成多个 T2/T3 子需求 | 2 + 立项审批 | 主干 15 态 |

门禁由插件按 `tier` 物理裁剪：级别不走该状态时 `state_transition` 直接拒绝；进入关键状态前校验该级别要求的产出文件是否存在。

## 四、命令速查表

> **斜杠命令怎么进 `/` 菜单**：宿主只扫描两处提示模板——`<工作区>/.pi/prompts/*.md` 与 `~/.pi/agent/prompts/*.md`，且没有插件贡献点（`commands.register` 只登记可执行命令，不能注入 prompt）。
> 因此本插件**加载时自动**把 `.pi/commands` 的每条命令渲染成自包含模板写进用户级目录：装一次、所有工作区可见，不需要任何额外操作。
> 写保护：只覆盖带 `managed-by: gwb.pi-workflow-gates` 的文件；同名但非本插件管理的模板一律跳过。项目级 `.pi/prompts`（若有）优先级更高，可用于在某个仓覆盖命令行为。

| 命令 | 阶段 | 角色 Agent | 核心产出 |
|---|---|---|---|
| `/req-new <需求名> [T0-T4]` | 需求承接 | 父 Agent 自执行 | 00-meta.md（含 tier）、01-intake.md |
| `/explore <想法>` | 探索（只读，不建档案） | 父 Agent 自执行 | 对话内一页结论：做不做/判级/第一步 |
| `/req-adopt <目标仓路径>` | 接入（任意阶段前置） | 父 Agent 自执行 | 目标仓具备 `.pi/commands` + `docs/` + `requirements/` |
| `/req-derive <本仓REQ> to <目标仓>` | 跨项目承接（派生） | 父 Agent 自执行 | 本仓 `derive/` 简报、目标仓 `.inbox/` 简报、父需求 dependsOn |
| `/req-clarify` | 需求澄清 | 需求分析师 | 02-clarification.md（边界+AC） |
| `/design` | 方案设计（含测试计划） | 架构设计师 + 测试工程师 | 03-design.md（DDD+三层映射）、08-test-plan.md |
| `/review` | 评审 + 人工复审 | 评审员 | 04-review.md；人工确认 → confirmed |
| `/breakdown` | 任务拆解 | 计划工程师 | 05-tasks.md（WBS） |
| `/dev` | 开发 | 开发工程师 | 代码 + 任务勾选 |
| `/code-review` | 代码级评审（L1 机械 + L2 多视角 + 验证轮） | 代码评审员 + 代码评审验证官 | 06a-code-review.md、reviews/issues.json |
| `/cr` | Agent CR + 人工复验 | 架构师CR | 06-cr-report.md、07-cr-handoff.md |
| `/test-plan` | 测试执行与回归 | 测试工程师 | 用例执行结果回填 + 补充用例 |
| `/pre-release` | 上线检查 | 发布工程师 | 09-release.md |
| `/risk` | 风险管控（任意阶段） | 风险官 | 10-risks.md |
| `/change <描述>` | 变更管理（任意阶段） | 风险官 | changes/CHANGES.md |
| `/retro` | 归档复盘 | 复盘主持 | 11-retro.md + 流程优化提案 |

**机械检查（插件工具，不调模型）**

| 工具 | 时机 | 作用 |
|---|---|---|
| `design_lint` | /design 完成后、/review 前 | 七部分/术语表/调用链路八列/复用论证/编号带名/主链路禁过程/精简/日志，先 warn 后 block |
| `trace_matrix` | /breakdown 后、/cr 前 | AC → 任务 → 用例 → 证据 覆盖与缺口 |
| `verify_record` | 每个任务完成时 | 落 evidence.json；「完成」以证据为准 |
| `log_append` | 任意 | 过程流水 `log/YYYY-MM-DD.md`（只追加） |
| `dispatch_record` | 每次派发 | 校验模型绑定、记录派发与长跑进度 |
| `spec_merge` | /retro 归档 | 把 `spec-delta.md` 增量合并进 `specs/<capability>/spec.md` |
| `answer_return` | 派生需求答复后 | 问答自动回传父仓，不再人工转发 |
| `analyze` | /dev 之前 | 一致性闸：lint + 矩阵 + 产出齐全，只读 |
| `converge` | /cr 之前 | 收敛闸：补遗漏项到 05-tasks |

## 五、标准流程

```
/req-new → /req-clarify → /design（方案设计 + 测试计划同步产出）
→ /review（Agent 评审设计+用例 → 人工复审确认）→ /breakdown
→ /dev（参考测试用例边界场景）→ /code-review（L1 机械 → L2 语义 → 验证轮）→ /cr（CR 循环 → 编译验证 → 人工复验）
→ /test-plan（执行用例与回归）→ /pre-release → 发布 → /retro

/risk、/change 贯穿全程，任意阶段可执行
```

**小需求裁剪**：简单需求可跳过 `/review`、`/breakdown`，由父 Agent 在 `/req-clarify` 完成后提示用户选择「轻量路径」（clarified → planned → developing），跳过标记记入 `00-meta.md` 备注。

## 五之二、可选能力：Jev 判定

语义判断（机器判不出准头）交给 Jev（`JevClassify`）。**没配置就按插件规则走，不阻塞。**

| 用在 | 判什么 | 无 Jev 时 |
|---|---|---|
| `/req-new` | 体量级别 T0-T4（choice） | 按判级表人工定，判不准取 T2 |
| `/design`、`/review` | `design_lint` 的 `needsJudge` 项：自造词是否真自造、段落是否真冗余（bool） | 按 lint 结论处理（warn 不拦） |
| `/cr` | 争议问题的级别（blocker/major/minor） | 按评审员判断 |
| `/retro` | 打回原因归类（自造词/太粗/臃肿/过度设计/编号不清/漏图/其他） | `metrics_record` 的 reason 手填 |

探测：工具列表里有 `JevClassify` 就用；没有就在 `log/` 记一行「Jev 未配置，按规则处理」。
**边界**：Jev 只做判定，不产出内容；结论必须落档案或 log，且不改变门禁的机械判据。

## 六、关键规则

1. 阶段门禁：不满足前置状态时提示「请先执行 /xxx」，不静默跳过
2. 提交信息强制带需求编号：`REQ-xxx: <描述>`
3. CR 循环：直到一整轮无 blocker/major 才出 CR 报告结论，随后必须生成人工复验交接文档
4. 人工复验是硬门禁：`cr-human` → `cr-confirmed` 必须由用户明确确认
5. 人工复审是硬门禁：`reviewed` → `confirmed` 必须由用户确认方案与测试用例后才能拆解
6. 架构红线：见 [ARCHITECTURE.md](./ARCHITECTURE.md)，三条硬规则违反即 blocker
7. 方案一致性：每次开发完成后先过「方案一致性比对」（/cr 第零阶段）
8. 跨项目依赖：需求跨项目时用 `registry_dep` 声明 dependsOn（只告警不阻塞）；注册中心镜像在 `requirements/.registry.json`（运行时文件，不入 git）——与设计冲突由架构师裁定改代码或改设计，确保代码与设计 1:1 还原；设计文档只保留最终态，不留过程结论
9. **主链路只留最终态**：00/01/02/03/05/08/09 只写结论；评审意见、被否方案、打回原因一律进 `log/YYYY-MM-DD.md`
10. **完成以证据为准**：勾选任务前必须 `verify_record`；`converge` 对「勾选但无证据」直接报缺口
11. **文档精简**：先结论后细节；一段 ≤3 句、一组列表 ≤7 项、不写套话；能用表格不用散文
12. **代码精简**：先复用后新写；删优于加；不加没人要的抽象；非平凡逻辑必须带一个小测试
13. **活规格**：需求只写增量（spec-delta.md），归档时 `spec_merge` 并入 `specs/`；新需求读 specs 而不是考古旧档案
14. **粒度**：一个任务 ≈ 一次会话（参考 ≤500 行、几个文件）；两个独立目标就拆；做不完的余量写 `deferred-work.md`，不静默膨胀
15. **派发纪律**：每次派发调 `dispatch_record`，模型与 `docs/role-bindings.json` 不一致即被拒；长跑每 10 分钟记一次进度
16. **提交时机**：任务级本地 commit 允许（`REQ-xxx: 描述`）；**push / 开 PR 必须等 `/cr` 通过（cr-confirmed）**
17. **幂等**：`verify_record`/`log_append` 重复上报自动去重；跨仓写失败进重试队列（`pending_effects`），加载时自动重试
18. **并发**：`00-meta.md` 有 `rev`，写回前校验；被别的会话抢先改过会拒写而不是静默覆盖
19. **日志刚需**：关键路径带业务标识与 traceId、异常带栈、敏感脱敏；禁循环体逐条日志与大对象打印

## 七、文件地图

```
.pi/commands/          13 个命令定义（宿主约定，必须在仓库根）
docs/
  WORKFLOW.md          本文档
  ORCHESTRATOR.md      父 Agent 总控协议（派发/摘要/门禁）
  ARCHITECTURE.md      架构宪法（DDD 设计 + 三层落地）
  SEMANTICS.md         语义口径机制与模板（台账落在被评审项目内，R8 判据）
  PROFILE.md           开发者画像（随需求积累进化）
  EVOLUTION.md         流程优化提案记录
  roles/               12 个角色定义（含代码评审员 / 代码评审验证官）
  templates/           15 个阶段文档模板
packages/
  pi-workflow-gates/   机械层门禁插件（建档/状态机/账本），独立打包 .piplug
  pi-code-review/      代码级评审判定插件（归一/diff过滤/指纹去重/门禁/报告，7 个 cr_* 工具）
assets/                要复制进被评审项目根的资产（复制后成为项目的 rules/ 与 scripts/review/）
  rules/                 severity.json 严重度映射、semgrep/ 自有红线
  scripts/review/        run-l1.sh：diff 落盘 + 11 个工具 + status.json
requirements/          需求档案存放区（每个需求含 log/ 过程流水、evidence.json、spec-delta.md）
specs/                 活规格：系统当前行为，按能力组织（由 spec_merge 维护）
docs/role-bindings.json 角色 → 模型绑定（换模型改这里，不改协议）
```
