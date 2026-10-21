---
description: 测试执行与用例回归：执行设计期产出的测试用例并回填结果（用例本身在 /design 阶段产出）
---

# /test-plan

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`cr-confirmed`（或 `testing`，表示继续执行/补充用例）。
   - 若 status 为 `cr-human` 或更早，提示：「CR 尚未通过人工确认，请先执行 /cr <需求编号>」，停止执行。
   - 若 status 为 `ready-release` 或之后，提示：「需求已进入发布阶段；如需补充测试，请先执行 /change <变更描述>」，停止执行。
3. 校验 `08-test-plan.md` 存在（应为 /design 阶段产出）；缺失时提示：「测试计划不存在——正常流程中它在 /design 阶段与方案设计一并产出，请检查档案」，停止执行。

## 执行流程

1. 父 Agent 更新 `00-meta.md`：`status: testing`，更新 `updated`。
2. 派发 Task 子代理，任务简报：
   - 角色：测试工程师
   - 任务：执行设计期产出的测试用例，回填执行结果；针对实现差异补充用例
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`、`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`、`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`requirements/REQ-YYYYMMDD-<slug>/07-cr-handoff.md`、`workflow/PROFILE.md`、相关源码（只读）
   - 产出文件：更新 `requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`（回填执行结果列 + 补充用例）
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
3. 执行要求：
   - 逐条执行 `08-test-plan.md` 用例，回填「执行结果」列（通过/失败+原因）；失败用例按 blocker 处理，派发开发工程师修复后重新执行
   - 对照 `07-cr-handoff.md` 的入口清单与重点风险区，核验回归用例覆盖；实现与设计存在差异时补充用例，新增用例同样要求关联 AC 编号
   - 执行完成后更新「AC 覆盖矩阵」与覆盖率统计
4. 父 Agent 向用户汇报用例执行通过率、失败清单与 AC 覆盖率，供用户确认。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`
- 状态流转：修改 `00-meta.md` 的 `status: testing`，更新 `updated`。
- 更新 `SUMMARY.md`：追加「测试阶段」摘要（≤5 行），含用例总数、AC 覆盖率、执行结论。
- 测试执行通过后提示用户执行 `/pre-release <需求编号>`。
