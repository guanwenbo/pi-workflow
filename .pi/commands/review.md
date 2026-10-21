---
description: 设计评审：评审员审查设计稿+测试计划，Agent 评审通过后需人工复审确认
---

# /review

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`designing`，且 `requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`08-test-plan.md` 必须存在。
   - 若 03-design.md 或 08-test-plan.md 不存在，提示：「设计稿或测试计划不存在，请先执行 /design <需求编号>」，停止执行。
   - 若 status 为 `clarified` 或更早，提示：「设计尚未开始，请先执行 /design <需求编号>」，停止执行。
   - 若 status 为 `reviewed`，提示：「Agent 评审已通过，等待人工复审：请确认 03-design.md 与 08-test-plan.md 后，回复『复审通过』」，停止执行。
   - 若 status 为 `confirmed` 或之后，提示：「人工复审已通过（当前状态：<status>），请先执行 /breakdown <需求编号>」，停止执行。

## 执行流程

1. 派发 Task 子代理，任务简报：
   - 角色：评审员
   - 任务：对照评审 Checklist 逐项审查设计稿，输出评审纪要
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`、`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`、`workflow/ARCHITECTURE.md`、`workflow/PROFILE.md`、`workflow/templates/04-review.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/04-review.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
2. 评审 Checklist 逐项自查（写入 04-review.md，每项标注 通过/不通过/不适用）：
   - AC 覆盖：02-clarification.md 每条 AC 是否在设计中有落点
   - DDD 完整性：限界上下文/聚合根/实体值对象/领域事件是否齐备且边界合理
   - 三层架构合规：单向调用、无循环依赖、业务逻辑仅在业务层、下层无冗余校验
   - 接口契约：出入参/错误码是否完整、与 AC 一致
   - 数据模型：字段/索引/一致性设计是否合理
   - 非功能需求：性能/安全/兼容指标是否量化可验收
   - 风险初评：是否识别重大技术风险
   - 测试计划评审：每条 AC 至少 1 条用例；边界/异常用例是否对照设计稿「边界定义」「分布式设计」充分推导；用例可独立执行；无可测试性死角
3. `04-review.md` 评审纪要分为三节：**待决议项**（需用户拍板）、**已决议项**、**修改要求**（编号 RI-01、RI-02…，每条指明设计稿小节与修改内容）。
4. 若存在「待决议项」，父 Agent 逐条与用户确认，结论回写 04-review.md。
5. 若存在「修改要求」，回流给架构设计师修订（按 /design 的派发简报格式，额外附可读文件 04-review.md，要求修订 03-design.md 并在 04-review.md 中逐条标注修订结果）；修订后可再次派发评审员复审。
6. 全部 Checklist 通过、待决议项清零、修改要求全部闭环后，Agent 评审通过，`status: reviewed`。
7. **人工复审门禁（硬性）**：父 Agent 将 `03-design.md` 与 `08-test-plan.md` 一并呈现给用户复审，明确提示重点看：三层映射、边界定义、分布式设计、边界/异常用例。等待用户结论：
   - **复审通过** → `status: confirmed`，更新 `updated`
   - **打回** → 打回原因记入 `00-meta.md` 的 `metrics.人工打回原因`（追加，含日期），`metrics.返工次数` +1，`status` 回退 `designing`，修订后重新执行本命令

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/04-review.md`；必要时修订 `03-design.md`、`08-test-plan.md`
- 状态流转：Agent 评审通过置 `reviewed`；人工复审通过置 `confirmed`；打回则回退 `designing`。
- 更新 `SUMMARY.md`：追加「评审阶段」摘要（≤5 行），含评审结论、修改要求数量、关键决议。
- 人工复审通过后提示用户执行 `/breakdown <需求编号>`。
