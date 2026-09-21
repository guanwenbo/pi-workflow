---
description: 归档复盘：产出复盘报告与流程改进提案，归档需求目录
---

# /retro

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`released`。
   - 若 status 为 `ready-release` 或更早，提示：「需求尚未发布（当前状态：<status>），请先完成发布流程（/pre-release <需求编号>）」，停止执行。
   - 若 status 为 `archived`，提示：「该需求已归档，复盘报告见 11-retro.md」，停止执行。
3. 校验 `00-meta.md` 的 `metrics` 字段齐备（耗时、返工次数、CR 轮次、人工打回原因），缺失项先补录。

## 执行流程

1. 派发 Task 子代理，任务简报：
   - 角色：复盘主持
   - 任务：汇总全生命周期档案，产出复盘报告与流程改进提案
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/` 目录下**全部档案**（00-meta.md、SUMMARY.md、01-intake.md 至 10-risks.md、changes/ 全部变更单）、`workflow/PROFILE.md`、`workflow/templates/11-retro.md`、`workflow/EVOLUTION.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/11-retro.md`；提案追加至 `workflow/EVOLUTION.md` 提案区
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
2. `11-retro.md` 内容要求：
   - **目标达成度**：对照 01-intake.md 的商业价值与 02-clarification.md 的 AC，逐条评估达成情况
   - **偏差分析**：工期偏差（计划工时 vs 实际耗时）、质量偏差（CR 轮次、返工次数、人工打回次数及原因归类）、范围偏差（变更单数量与影响）
   - **经验教训**：做得好的 / 做得差的 / 下次如何改进，各至少 1 条且必须引用具体事实（轮次、任务编号、变更单编号）
3. 流程改进提案（写入 `workflow/EVOLUTION.md` 提案区，**不自动生效**）：
   - 本需求的卡点分析：哪个阶段耗时最长、为何卡住
   - 返工点分析：返工集中在哪些任务/层级、根因
   - 优化提案：针对 `workflow/templates/` 模板、各角色 Checklist、门禁规则（状态机前置条件）的具体修改建议
   - 每条提案格式：编号 EV-YYYYMMDD-NN | 提案内容 | 依据（引用本需求事实）| 状态=待审批
   - 父 Agent 将提案逐条呈现给用户审批；用户批准后才允许落实到对应模板/规则文件
4. 归档：复盘完成后，父 Agent 将需求目录 `requirements/REQ-YYYYMMDD-<slug>/` 移入 `requirements/archived/`（目录不存在则创建）。

## 产出与状态流转

- 产出文件：
  - `requirements/REQ-YYYYMMDD-<slug>/11-retro.md`
  - `workflow/EVOLUTION.md` 提案区新增提案（待用户审批，不自动生效）
  - 归档目录：`requirements/archived/REQ-YYYYMMDD-<slug>/`
- 状态流转：复盘归档后修改 `00-meta.md` 的 `status: archived`，更新 `updated`（归档前先更新再移动目录）。
- 更新 `SUMMARY.md`：追加「复盘阶段」摘要（≤5 行），含目标达成结论、关键教训、提案数量。
- 更新 `00-meta.md` 的 `metrics.耗时` 为 created 至归档的实际总耗时。
