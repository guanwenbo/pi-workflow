# 企业级需求承接工作流（WORKFLOW.md）

> 多角色 Agent 总控版。本文档是整套工作流的总说明与速查表。

## 一、这是什么

一套运行在 PI-Desktop 上的企业级应用需求承接工作流：**父 Agent 总控 + 10 个角色 Agent**，覆盖需求从承接到归档复盘的全生命周期。纯 Markdown 配置，无需安装，进 Git 版本管理。

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

## 四、命令速查表

| 命令 | 阶段 | 角色 Agent | 核心产出 |
|---|---|---|---|
| `/req-new <需求名>` | 需求承接 | 父 Agent 自执行 | 00-meta.md、01-intake.md |
| `/req-clarify` | 需求澄清 | 需求分析师 | 02-clarification.md（边界+AC） |
| `/design` | 方案设计（含测试计划） | 架构设计师 + 测试工程师 | 03-design.md（DDD+三层映射）、08-test-plan.md |
| `/review` | 评审 + 人工复审 | 评审员 | 04-review.md；人工确认 → confirmed |
| `/breakdown` | 任务拆解 | 计划工程师 | 05-tasks.md（WBS） |
| `/dev` | 开发 | 开发工程师 | 代码 + 任务勾选 |
| `/cr` | Agent CR + 人工复验 | 架构师CR | 06-cr-report.md、07-cr-handoff.md |
| `/test-plan` | 测试执行与回归 | 测试工程师 | 用例执行结果回填 + 补充用例 |
| `/pre-release` | 上线检查 | 发布工程师 | 09-release.md |
| `/risk` | 风险管控（任意阶段） | 风险官 | 10-risks.md |
| `/change <描述>` | 变更管理（任意阶段） | 风险官 | changes/CHANGES.md |
| `/retro` | 归档复盘 | 复盘主持 | 11-retro.md + 流程优化提案 |

## 五、标准流程

```
/req-new → /req-clarify → /design（方案设计 + 测试计划同步产出）
→ /review（Agent 评审设计+用例 → 人工复审确认）→ /breakdown
→ /dev（参考测试用例边界场景）→ /cr（CR 循环 → 编译验证 → 人工复验）
→ /test-plan（执行用例与回归）→ /pre-release → 发布 → /retro

/risk、/change 贯穿全程，任意阶段可执行
```

**小需求裁剪**：简单需求可跳过 `/review`、`/breakdown`，由父 Agent 在 `/req-clarify` 完成后提示用户选择「轻量路径」（clarified → planned → developing），跳过标记记入 `00-meta.md` 备注。

## 六、关键规则

1. 阶段门禁：不满足前置状态时提示「请先执行 /xxx」，不静默跳过
2. 提交信息强制带需求编号：`REQ-xxx: <描述>`
3. CR 循环：直到一整轮无 blocker/major 才出 CR 报告结论，随后必须生成人工复验交接文档
4. 人工复验是硬门禁：`cr-human` → `cr-confirmed` 必须由用户明确确认
5. 人工复审是硬门禁：`reviewed` → `confirmed` 必须由用户确认方案与测试用例后才能拆解
6. 架构红线：见 [ARCHITECTURE.md](./ARCHITECTURE.md)，三条硬规则违反即 blocker
7. 方案一致性：每次开发完成后先过「方案一致性比对」（/cr 第零阶段）——与设计冲突由架构师裁定改代码或改设计，确保代码与设计 1:1 还原；设计文档只保留最终态，不留过程结论

## 七、文件地图

```
.pi/commands/          12 个命令定义
workflow/
  WORKFLOW.md          本文档
  ORCHESTRATOR.md      父 Agent 总控协议（派发/摘要/门禁）
  ARCHITECTURE.md      架构宪法（DDD 设计 + 三层落地）
  PROFILE.md           开发者画像（随需求积累进化）
  EVOLUTION.md         流程优化提案记录
  roles/               10 个角色定义
  templates/           14 个阶段文档模板
requirements/          需求档案存放区
```
