# requirements — 需求档案目录

## 目录用途

本目录存放所有需求的全生命周期档案。每个需求一个独立目录，目录下按阶段沉淀文档，由对应角色 Agent 按模板（workflow/templates/）填充，保证任何角色可随时通过档案恢复完整上下文。

## 需求编号规范

- 格式：`REQ-YYYYMMDD-<slug>`
  - `YYYYMMDD`：需求承接日期
  - `<slug>`：需求英文短标识，小写字母 + 中划线，如 `order-timeout-close`
- 档案目录：`requirements/REQ-YYYYMMDD-<slug>/`
- 变更文档：`requirements/REQ-YYYYMMDD-<slug>/changes/CHG-NN.md`（NN 从 01 开始递增）

## 档案文件清单

| 文件 | 含义 | 对应阶段 | 模板 |
| --- | --- | --- | --- |
| 00-meta.md | 元信息（frontmatter）、过程指标 metrics、状态变更日志 | 全生命周期 | workflow/templates/00-meta.md |
| SUMMARY.md | 按阶段分节的累计摘要（每节 ≤5 行），用于快速恢复上下文 | 全生命周期 | workflow/templates/summary.md |
| 01-intake.md | 需求承接：背景、业务价值、干系人、优先级 | draft | workflow/templates/01-intake.md |
| 02-clarification.md | 澄清：问题清单、需求边界、验收标准 AC、异常场景 | clarifying → clarified | workflow/templates/02-clarification.md |
| 03-design.md | 技术设计：技术选型、领域模型、三层模块划分、数据模型、接口契约 | designing | workflow/templates/03-design.md |
| 04-review.md | 设计评审：Checklist、决议项、修改要求、评审结论 | reviewed | workflow/templates/04-review.md |
| 05-tasks.md | 任务拆解：WBS 任务表、里程碑 | planned | workflow/templates/05-tasks.md |
| 06-cr-report.md | Agent 自审 CR 报告（按轮次） | cr-agent | workflow/templates/06-cr-report.md |
| 07-cr-handoff.md | 人工复验交接文档：改动范围、入口清单、核心流程、风险区 | cr-human | workflow/templates/07-cr-handoff.md |
| 08-test-plan.md | 测试计划：用例（关联 AC）、覆盖率统计 | testing | workflow/templates/08-test-plan.md |
| 09-release.md | 发布计划：发布 Checklist、发布步骤、回滚预案 | ready-release | workflow/templates/09-release.md |
| 10-risks.md | 风险登记册（全生命周期持续更新） | 全生命周期 | workflow/templates/10-risks.md |
| 11-retro.md | 复盘：目标达成度、过程数据、偏差分析、改进提案 | released → archived | workflow/templates/11-retro.md |
| changes/CHG-NN.md | 需求变更记录（原因、内容、影响分析、审批结论） | change-requested | workflow/templates/CHG-NN.md |

## 状态机一览

主流程：

```
draft → clarifying → clarified → designing → reviewed → planned
      → developing → cr-agent → cr-human → cr-confirmed → testing
      → ready-release → released → archived
```

异常状态：

- `blocked`：任一阶段被阻塞（依赖未就绪、等待决策等），解除后回到原阶段
- `change-requested`：收到需求变更（见 changes/CHG-NN.md），审批通过后回到原阶段继续

每次状态迁移须在 00-meta.md 的「状态变更日志」中追加记录。

## 过程纪律（EP-05 / EP-07，项目级强规则）

> 完整条款见 `workflow/PROFILE.md` 五、协作与流程偏好 与 `workflow/EVOLUTION.md` EP-05/EP-07；本节是每个需求目录必须遵守的摘要。

1. **档案改动先送评（EP-05）**：`requirements/` 下任何档案改动（含纯文案、裁定登记、计数修订）**必须先送 CR 再提交**，并在 `06-cr-report.md` 留轮次记录 + `00-meta.md` 同步账本。门禁归属：代码 ⇒ EP-05 代码 CR；触及技术口径/结论的档案 ⇒ EP-03 方案评审；纯档案 ⇒ EP-05 聚焦增量 CR。豁免：同一轮 CR 自身产出物（轮次记录、`CR 轮次` 自增、该轮要求就地修订的档案）不单独送评，但**不免除 M 项修订后的收敛复核**。
2. **账本口径（EP-07）**：`CR 轮次` = 同一提交内已落盘的**最高**轮次（= `06-cr-report.md` 最后一条，**不是 +1**）；`返工次数` = 同一档案链每次「不通过」计 1（通过轮不计）；**EP-05 代码 CR 不计入档案链返工**；两者同批落盘并写 `N = N-1 + 1` 可核算式。
3. **纯档案批时态（EP-07）**：未实施代码一律将来时 +「（本批仅档案：代码待实施、不随本批提交）」；门禁写「基线…实现后须复跑」；代码批**同批**翻事实 + 计数三件套（`08-test-plan` 总数/类型分布/执行状态 + `09-release` 测试执行行）。
4. **收敛复核（EP-07）**：每轮 major 修订后必须做**限定范围收敛复核**（只核上轮 M/m 闭环 + 有无新矛盾，不重开全案），不得自行闭环。
5. **关键判据变异验证（EP-07）**：日志字段位/报文键/常量/开关位必须被用例钉住，并做「临时摘掉必 FAILURE」自证后恢复源码。
6. **EP 编号体系**：EP-01 配置清单 / EP-02 CR 判定纪律 / EP-03 方案评审门禁 / EP-04 单文件变更台账 / EP-05 任何改动过 CR / EP-06 自测收尾一致性 CR / EP-07 过程纪律 5 条上收。
