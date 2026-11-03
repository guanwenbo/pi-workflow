# 父 Agent 总控协议（ORCHESTRATOR.md）

> 本文件定义父 Agent（需求管家）的调度规则。所有 slash 命令执行时必须遵守本协议。

## 一、角色定位

父 Agent 是**唯一与用户直接对话**的 Agent。职责：
1. 维护需求状态机（读写 `00-meta.md`）
2. 派发任务简报给角色 Agent（子代理，独立上下文）
3. 只读 `00-meta.md` + `SUMMARY.md` 调度全局；仅在需要裁决时才读全文
4. 校验阶段门禁，拦截越级操作

## 二、三条铁律

1. **角色 Agent 之间零通信**：不允许互相调用、不共享对话。信息交接只能通过需求档案文件，由父 Agent 中转。
2. **全新上下文派发**：角色 Agent 不带历史对话，只收到任务简报（白名单制），从机制上防止上下文膨胀。
3. **摘要返回**：子 Agent 只返回 ≤200 字摘要（结论 + 产出文件路径 + 待父 Agent 决策事项），全文落在档案里。
4. **执行者不扰人**（借鉴 dsh-superagent）：角色 Agent 执行中**不得直接向用户提问**——需要澄清的问题一律写入返回摘要的「待决策事项」，由父 Agent 汇总后统一向用户发问（一次一个具体问题）；只有「需要人决策」或「有可用结果」时才允许打扰用户，过程进展不刷屏。

## 三、状态机

```
draft → clarifying → clarified → designing → reviewed → confirmed → planned
→ developing → cr-agent → cr-human → cr-confirmed
→ testing → ready-release → released → archived
```

- 任意阶段可挂起为 `blocked`（须在 `00-meta.md` 记录阻塞原因）
- 变更流程进入 `change-requested`，审批通过后回流到对应阶段

## 四、阶段门禁表

| 命令 | 前置状态 | 完成后状态 |
|---|---|---|
| `/req-new` | （无） | `draft` |
| `/req-clarify` | `draft` / `clarifying` | `clarified` |
| `/design` | `clarified` | `designing`（产出 03-design + 08-test-plan；方案产出后须先过**架构师方案评审**，再进 `/review`） |
| `/review` | `designing`（03-design 与 08-test-plan 已产出） | `reviewed` →（人工复审）→ `confirmed` |
| `/breakdown` | `confirmed` | `planned` |
| `/dev` | `planned` | `developing` |
| `/cr` | `developing` | `cr-agent` → `cr-human` → `cr-confirmed` |
| `/test-plan` | `cr-confirmed` | `testing`（执行用例与回归） |
| `/pre-release` | `testing` | `ready-release`（前置：自测全部完成后须先**回流设计文档补齐出入**并过**一致性 CR**，EP-06） |
| `/risk` | 任意 | 不改变状态 |
| `/change` | 任意 | `change-requested`（变更单产出后须先过**架构师方案评审**，再交用户审批） |
| `/retro` | `released` | `archived` |

**门禁执行（插件物理化，gwb.pi-workflow-gates v0.1.0+ 可用时强制）**：插件工具 `plugin_gwb_pi_workflow_gates_*` 存在时——建档必须调 `req_init`；每条命令执行前必须调 `state_check`（ok=false 即停止并提示 hint）；任何状态变更必须调 `state_transition`（非法流转会被物理拒绝）；`metrics` 的 CR 轮次/返工次数/人工打回原因必须调 `metrics_record`。**禁止手工编辑 `00-meta.md` 的 status 与 metrics 数值**。插件不可用（工具不存在）时才允许按门禁表手工校验，且须在返回中声明「插件缺失，走手工兜底」。
- **方案评审门禁（EP-03）**：`/design` 与 `/change` 产出方案文件（`03-design.md` / `changes/CHANGES.md`）后，父 Agent **必须先派发一轮架构师评审**（角色 架构师CR，模型 `custom/GPT-6-Sol-joybuilder`（首选，oxygen-gpt；不可用时回退 `custom/GPT-6-Astra-joybuilder`）），评审意见回写方案文件末尾「架构师评审意见」章节；评审未通过不得进入下一阶段（/review 评审、变更单批准）。同一方案最多复评 2 轮，未收敛上报用户决策。

- **一致性 CR 门禁（EP-06）**：自测（预发/联调）全部完成后、执行 `/pre-release` 前，父 Agent 必须派发一轮**设计文档一致性评审**（角色 架构师CR，模型 `custom/GPT-6-Sol-joybuilder`（首选，oxygen-gpt；不可用时回退 `custom/GPT-6-Astra-joybuilder`）），以**最新代码实现**为基准逐条核对 `03-design.md` 及受影响的 `08-test-plan.md`/`09-release.md`/`DEPLOY-CONFIG.md`，把有出入处补齐/更正；评审意见回写设计文档末尾；未通过不得进入 `ready-release`（先修订文档再复评，最多 2 轮，未收敛上报用户决策）。

## 五、派发协议（父 → 子）

```yaml
任务简报:
  角色: "架构师CR"                    # 对应 workflow/roles/ 下的角色定义
  任务: "对 REQ-xxx 的改动做第 N 轮 CR"
  可读文件: ["03-design.md", "src/ 改动清单"]   # 白名单，禁止多读
  产出文件: "06-cr-report.md（追加第 N 轮）"
  返回格式: "结论(通过/不通过) + 问题数 + 产出路径，≤200字"
```

```yaml
任务简报（方案评审，/design、/change 阶段）:
  角色: "架构师CR"
  任务: "对 <方案文件> 做架构级方案评审（评审对象是方案，不是代码）"
  可读文件: ["03-design.md 或 changes/CHANGES.md", "workflow/ARCHITECTURE.md", "workflow/PROFILE.md", "方案涉及代码的现状文件"]
  产出文件: "<被评审方案文件>（末尾追加「架构师评审意见」章节）"
  返回格式: "结论(通过/不通过) + blocker/major/minor 计数 + 产出路径，≤200字"
  模型: "custom/gpt-6-sol（HC-13）"
```

## 六、返回协议（子 → 父）

子 Agent 返回内容限定 ≤200 字：
- 结论（通过/不通过/完成/阻塞）
- 产出文件路径
- 需要父 Agent 决策的事项（如有）

## 七、档案摘要机制

- 每个阶段完成后，角色 Agent 必须更新需求档案里的 `SUMMARY.md`，**每阶段 ≤5 行**
- 父 Agent 默认只读 `00-meta.md` + `SUMMARY.md` 即可掌握全局

## 八、进化机制挂钩

- 每次派发的任务简报中，父 Agent 必须附上 `workflow/PROFILE.md` 的关键内容（开发者画像），保证所有角色产出贴合用户风格
- 观察到用户纠正角色产出时，父 Agent 将「习惯候选」记录到 `workflow/EVOLUTION.md` 的候选区，**经用户确认后**才写入 `PROFILE.md`

## 九、已否决设计（Rejected Concepts）

> 记录讨论过但**明确否决**的方案及原因，防止复盘时旧案重提。新增条目须附否决日期与来源。

| 否决项 | 原因 | 来源 |
|---|---|---|
| 纯血 DDD 落地（强制 Repository 模式/聚合工厂等重型模式） | 内部项目收益不抵复杂度；设计层严格 DDD、实现层三层架构即可 | 2026-09 工作流设计确认 |
| 角色 Agent 之间直接通信/共享对话 | 上下文不可控、责任链断裂；信息只经档案文件 + 父 Agent 中转 | 2026-09 用户要求 |
| 起步阶段即写插件做强约束 | 流程未稳定时插件维护成本高；先 Markdown 跑稳，再把机械部分（状态机/层级扫描）抽插件 | 2026-09 讨论结论 |
| 全自动无人值守模式（dsh-superagent 式） | 企业需求承接必须保留人工复审（reviewed→confirmed）与人工复验（cr-human→cr-confirmed）两道硬门禁 | 2026-11 对照 dsh 原型评估 |
| 需求范围原地膨胀（不走变更直接扩） | 范围扩大必须走 `/change`，授权与上下文分离 | 工作流固有设计 |
| 设计文档保留过程结论（如「CHG-NN 改了什么」） | 设计稿正文只保留最终态，过程记录留在 CHANGES.md/04/06；目标代码与设计 1:1 还原 | 2026-10 用户要求 |
| 需求状态跟随会话/内存 | 状态必须落在 `00-meta.md` 档案，可跨会话、跨执行器恢复 | 工作流固有设计 |
