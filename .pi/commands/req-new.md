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

**插件可用时（首选）**：调用插件工具 `plugin_gwb_pi_workflow_gates_req_init`（参数：title=需求名，slug=需求名小写连字符，owner/priority 已知则填），工具自动完成编号生成、目录创建、模板拷贝与 frontmatter 填写；返回 ok=false 或报错（如目录已存在）时停止执行并提示用户。**禁止手工创建档案目录与文件。**

插件不可用时的手工兜底：

1. 生成需求编号：`REQ-YYYYMMDD-<slug>`，其中 YYYYMMDD 为当天日期，slug 为需求名（小写、连字符）。
2. 创建需求档案目录：`requirements/REQ-YYYYMMDD-<slug>/`，并创建空目录 `changes/`。
3. 按模板 `docs/templates/00-meta.md` 生成 `00-meta.md`，frontmatter 填写：id、title、status=draft、priority/owner 留空待用户填写、created/updated 为当天日期。
4. 按模板 `docs/templates/01-intake.md` 生成 `01-intake.md`，未知字段标注「待用户填写」，不得编造。
5. 按模板 `docs/templates/SUMMARY.md` 生成 `SUMMARY.md`，写入首条摘要（≤5 行）：需求编号、需求名、创建时间、当前阶段 intake。

## 产出与状态流转

- 产出文件：
  - `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`（status=draft）
  - `requirements/REQ-YYYYMMDD-<slug>/01-intake.md`
  - `requirements/REQ-YYYYMMDD-<slug>/SUMMARY.md`
  - 空目录 `requirements/REQ-YYYYMMDD-<slug>/changes/`
- 状态流转：新建即 `draft`，无前置状态。
- 更新 `00-meta.md` 的 `updated` 字段为当天日期。
- 返回给用户：档案目录路径 + 待补全字段清单（01-intake.md 中标注「待用户填写」的项），并提示下一步执行 `/req-clarify REQ-YYYYMMDD-<slug>`。
