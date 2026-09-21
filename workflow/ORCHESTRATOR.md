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

## 三、状态机

```
draft → clarifying → clarified → designing → reviewed → planned
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
| `/design` | `clarified` | `designing` → 产出后 `reviewed` 前为 `designing` |
| `/review` | `designing`（03-design.md 已产出） | `reviewed` |
| `/breakdown` | `reviewed` | `planned` |
| `/dev` | `planned` | `developing` |
| `/cr` | `developing` | `cr-agent` → `cr-human` → `cr-confirmed` |
| `/test-plan` | `cr-confirmed` | `testing` |
| `/pre-release` | `testing` | `ready-release` |
| `/risk` | 任意 | 不改变状态 |
| `/change` | 任意 | `change-requested` |
| `/retro` | `released` | `archived` |

**门禁执行**：命令开头先读 `00-meta.md` 校验状态，不满足时明确提示「请先执行 /xxx」，禁止静默跳过。

## 五、派发协议（父 → 子）

```yaml
任务简报:
  角色: "架构师CR"                    # 对应 workflow/roles/ 下的角色定义
  任务: "对 REQ-xxx 的改动做第 N 轮 CR"
  可读文件: ["03-design.md", "src/ 改动清单"]   # 白名单，禁止多读
  产出文件: "06-cr-report.md（追加第 N 轮）"
  返回格式: "结论(通过/不通过) + 问题数 + 产出路径，≤200字"
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
