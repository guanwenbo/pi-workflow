---
description: 本仓发起跨项目承接：把子需求派生到目标仓，生成建档简报并挂依赖
---

# /req-derive

参数：`<本仓REQ编号> to <目标仓名或绝对路径>`

示例：`/req-derive REQ-20261106-fresh-home-icon-fix-guide-click to airp-fdc-marketing`

用于「父需求在本仓、落地能力在另一个仓」的场景。派生出的子需求在目标仓建档，父需求通过 `dependsOn` 指向它（**父等子**，依赖只告警不阻塞，节奏由人工把控）。

## 前置校验

1. 参数缺失或缺少 `to` 时，提示格式：`/req-derive <本仓REQ编号> to <目标仓名或绝对路径>`，停止执行。
2. 本仓需求档案必须存在（工具会读 `requirements/<reqId>/00-meta.md`，不存在直接报错 → 提示先 `/req-new`）。
3. 本仓需求必须在跨项目注册中心登记（老档案未登记会报错 → 提示重新 `/req-new` 或在目标仓补登记）。
4. 目标仓必须**已接入** pi-workflow（`.pi/commands/req-new.md` 与 `docs/templates/01-intake.md` 在位）；未接入时工具报错并给出 `/req-adopt <路径>` 指引——此时先执行 `/req-adopt`，不要绕过。
5. 目标仓不能是当前仓（同仓拆分用 `/breakdown`）。

## 执行流程

本命令由父 Agent（需求管家）自己执行，**不派发任何角色 Agent**。

**插件可用时（首选）**：调用插件工具 `plugin_gwb_pi_workflow_gates_req_derive`，参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `reqId` | 是 | 本仓父需求编号 |
| `targetProject` | 是 | 目标仓绝对路径，或注册中心里已登记的仓名（支持片段匹配） |
| `title` | 否 | 派生子需求标题；缺省「<父需求标题>（<目标仓> 侧）」 |
| `slug` | 否 | 派生子需求 slug；缺省由父 slug + 目标仓名生成 |
| `note` | 否 | 交给目标仓承接的接口/能力边界，写入简报 |
| `questions` | 否 | 待目标仓答复的待定项（数组），写入简报 Q 清单 |

工具做的事：

1. 解析目标仓（绝对路径直用；仓名走注册中心反查），校验已接入；
2. 生成派生子需求编号（`REQ-<当天>-<slug>`）并登记进跨项目注册中心（带 `derivedFrom`）；
3. 父需求 `dependsOn` 挂到派生子需求，双写注册中心与本仓 `00-meta.md` frontmatter；
4. 生成建档简报两份：本仓 `requirements/<reqId>/derive/<子REQ>.md`（留档可追）、目标仓 `requirements/.inbox/<子REQ>.md`（接力入口）；
5. 回填本仓 `01-intake.md` 的「跨项目承接记录」小节（按注册中心重算，人工可直接改回来）。

幂等：同一父需求 + 同一目标仓重跑复用已派生编号，不产生重复子需求；目标仓完成建档后重跑会把状态刷成「已建档」。

**插件不可用时**：告知用户需要插件 `gwb.pi-workflow-gates` ≥ 0.9.0 并停止（简报格式与依赖双写靠工具保证一致，手抄会产生漂移）。

## 产出与状态流转

- 工具返回：`derivedReqId`、`derivedTitle`、`derivedSlug`、`targetProject`、`files`、`pendingQuestions`、`next`、`warnings`。
- 本命令**不改父需求状态**；父需求继续按自己的阶段推进。
- 必须回报给用户的下一步：
  1. `cd <目标仓>`，在该仓 Agent 中执行 `/req-new`（标题与 slug 见简报）；
  2. 目标仓建档后执行 `/req-clarify`；
  3. 子需求 `released` 后，父需求的依赖告警自动消失。
- `warnings` 里的依赖告警必须原样转达用户——**只告警不阻塞**，是否等待由用户决定。
