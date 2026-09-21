---
description: 承接新需求：生成需求编号、创建需求档案目录与初始文件
---

# /req-new

参数：`<需求名>`（必填，如 `order-timeout`）

## 前置校验

无前置状态要求（这是流程起点）。执行前检查：

1. 若 `<需求名>` 未提供，提示：「请提供需求名，格式：`/req-new <需求名>`」，停止执行。
2. 检查 `requirements/` 下是否已存在同 slug 目录（如 `requirements/REQ-*-order-timeout/`）；若存在，提示：「该需求可能已存在：<已存在目录>，请先执行 /req-clarify 继续该需求，或换用新需求名」，禁止覆盖。

## 执行流程

本命令由父 Agent（需求管家）自己执行，**不派发任何角色 Agent**。

1. 生成需求编号：`REQ-YYYYMMDD-<slug>`，其中 YYYYMMDD 为当天日期，slug 为需求名（小写、连字符）。
2. 创建需求档案目录：`requirements/REQ-YYYYMMDD-<slug>/`，并创建空目录 `changes/`。
3. 按模板 `workflow/templates/00-meta.md` 生成 `00-meta.md`，frontmatter 填写：
   - `id`：REQ-YYYYMMDD-<slug>
   - `title`：需求名
   - `status`：draft
   - `priority`：留空待用户填写
   - `owner`：留空待用户填写
   - `created`：当天日期
   - `updated`：当天日期
   - `metrics`：`耗时`、`返工次数`、`CR轮次`、`人工打回原因` 均初始化为 0 / 空
4. 按模板 `workflow/templates/01-intake.md` 生成 `01-intake.md`，包含以下小节：**背景、干系人、商业价值、优先级、期望交付时间**。已知内容填入，未知字段明确标注「待用户填写」，不得编造。
5. 按模板 `workflow/templates/SUMMARY.md` 生成 `SUMMARY.md`，写入首条摘要（≤5 行）：需求编号、需求名、创建时间、当前阶段 intake。

## 产出与状态流转

- 产出文件：
  - `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`（status=draft）
  - `requirements/REQ-YYYYMMDD-<slug>/01-intake.md`
  - `requirements/REQ-YYYYMMDD-<slug>/SUMMARY.md`
  - 空目录 `requirements/REQ-YYYYMMDD-<slug>/changes/`
- 状态流转：新建即 `draft`，无前置状态。
- 更新 `00-meta.md` 的 `updated` 字段为当天日期。
- 返回给用户：档案目录路径 + 待补全字段清单（01-intake.md 中标注「待用户填写」的项），并提示下一步执行 `/req-clarify REQ-YYYYMMDD-<slug>`。
