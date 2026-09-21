---
description: 需求澄清：派发需求分析师生成澄清问题清单，确认需求边界与验收标准
---

# /req-clarify

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status` 字段。
2. 期望状态：`draft` 或 `clarifying`。
   - 若 status 为 `clarified` 或之后的状态，提示：「该需求已完成澄清（当前状态：<status>），请先执行 /design <需求编号>」，停止执行。
   - 若目录或 00-meta.md 不存在，提示：「需求档案不存在，请先执行 /req-new <需求名>」，停止执行。
3. 校验 `01-intake.md` 存在；不存在时提示先补建 intake 档案，禁止静默继续。

## 执行流程

1. 父 Agent 派发 Task 子代理，任务简报：
   - 角色：需求分析师
   - 任务：阅读 intake 档案，识别信息缺口与歧义点，生成澄清问题清单
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/01-intake.md`、`workflow/PROFILE.md`、`workflow/templates/02-clarification.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
2. 需求分析师在 `02-clarification.md` 中生成澄清问题清单，按主题分组（业务规则 / 数据 / 接口 / 非功能 / 边界场景），每题标注「阻塞级 / 重要 / 可选」。
3. 父 Agent 将问题清单逐条呈现给用户，进行**多轮确认**；每轮将用户答复回写 `02-clarification.md` 对应问题下，直至所有「阻塞级」问题闭环。
4. 全部确认后，再次派发需求分析师整理定稿，在 `02-clarification.md` 中输出：
   - 需求边界：明确「做什么 / 不做什么」（Out of Scope 单列）
   - 验收标准 AC：编号 AC-01、AC-02…，每条使用 Given/When/Then 格式
5. 角色 Agent 间零通信，所有信息仅经档案文件中转；父 Agent 负责传递用户答复。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`
- 状态流转：
  - 澄清进行中：修改 `00-meta.md` 的 `status: clarifying`，更新 `updated`
  - 澄清完成（AC 定稿）：修改 `status: clarified`，更新 `updated`
- 更新 `SUMMARY.md`：追加「澄清阶段」摘要（≤5 行），含 AC 数量、关键边界结论、遗留待决策项。
- 提示用户下一步执行 `/design <需求编号>`。
