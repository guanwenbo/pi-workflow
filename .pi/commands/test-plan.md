---
description: 测试计划：派发测试工程师从 AC 反推测试用例
---

# /test-plan

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`cr-confirmed`（或 `testing`，表示补充用例）。
   - 若 status 为 `cr-human` 或更早，提示：「CR 尚未通过人工确认，请先执行 /cr <需求编号>」，停止执行。
   - 若 status 为 `ready-release` 或之后，提示：「需求已进入发布阶段；如需补充测试，请先执行 /change <变更描述>」，停止执行。
3. 校验 `02-clarification.md` 存在且含 AC（Given/When/Then）；缺失时提示先完成 /req-clarify。

## 执行流程

1. 父 Agent 更新 `00-meta.md`：`status: testing`，更新 `updated`。
2. 派发 Task 子代理，任务简报：
   - 角色：测试工程师
   - 任务：从验收标准反推测试用例，覆盖正常/边界/异常/回归四类
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`、`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`requirements/REQ-YYYYMMDD-<slug>/07-cr-handoff.md`、`workflow/PROFILE.md`、`workflow/templates/08-test-plan.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
3. `08-test-plan.md` 要求：
   - 用例编号：TC-001、TC-002…
   - 每条用例字段：用例编号 | 类型（正常/边界/异常/回归） | 前置条件 | 操作步骤 | 预期结果 | 关联 AC 编号
   - **每条 AC 至少被 1 条用例覆盖**；产出末尾附「AC 覆盖矩阵」（AC 编号 × 用例编号），存在未覆盖 AC 时必须补齐
   - 回归用例：结合 07-cr-handoff.md 的入口清单与重点风险区选取
4. 父 Agent 向用户汇报用例总数、四类分布与 AC 覆盖率，供用户确认。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`
- 状态流转：修改 `00-meta.md` 的 `status: testing`，更新 `updated`。
- 更新 `SUMMARY.md`：追加「测试阶段」摘要（≤5 行），含用例总数、AC 覆盖率、执行结论。
- 测试执行通过后提示用户执行 `/pre-release <需求编号>`。
