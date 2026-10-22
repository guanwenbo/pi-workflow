---
description: 开发实现：派发开发工程师按 WBS 逐项实现并更新任务勾选状态
---

# /dev

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`planned` 或 `developing`（继续开发/被 CR 打回后的修复）。
   - 若 status 为 `reviewed` 或更早，提示：「任务尚未拆解，请先执行 /breakdown <需求编号>」，停止执行。
   - 若 status 为 `cr-agent`/`cr-human`/`cr-confirmed`，提示：「当前处于 CR 阶段，请按 /cr <需求编号> 的流程执行」，停止执行。
   - 若 status 为 `testing` 或之后，提示：「需求已过开发阶段；如需改动，请先执行 /change <变更描述>」，停止执行。
3. 校验 `05-tasks.md` 存在；缺失时提示先执行 /breakdown。

## 执行流程

1. 父 Agent 更新 `00-meta.md`：`status: developing`，更新 `updated`。
2. 按 `05-tasks.md` 的依赖顺序逐项派发 Task 子代理（同一批无依赖的任务可并行派发，但每个子代理独立上下文）：
   - 角色：开发工程师
   - **模型：`custom/DeepSeek-V4.1-Flash-A-joybuilder`**（oxygen-deepseek；强制显式指定，不得用默认模型）
   - **任务开发一律派 sub agent 执行，父 Agent 不直接写代码**
   - 任务：实现指定任务（明确任务编号范围，如 T-01 ~ T-03）
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/05-tasks.md`、`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`、`workflow/ARCHITECTURE.md`、`workflow/PROFILE.md`、相关源码目录
   - 产出文件：源码改动 + 更新 `05-tasks.md` 对应任务勾选状态
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
3. 实现前开发工程师**必读** `workflow/ARCHITECTURE.md` 与 `03-design.md` 的三层模块划分映射表，严格遵守：
   - 单向调用：API层 → 业务层 → 外部依赖层，禁止循环依赖
   - API层只做入参校验+防腐+参数转化，禁业务逻辑
   - 业务逻辑全部在业务层（可再拆子层）
   - 外部依赖层只做参数转化+防腐，绝对无业务逻辑，保持足够通用
   - 下层不做冗余参数校验
   - **参考 08-test-plan.md 实现**：开发时逐条对照测试用例的边界/异常场景，确保边界处理（空值、极值、并发、超时等）在代码中有对应逻辑，防止边界场景出问题
4. 提交信息强制格式：`REQ-YYYYMMDD-<slug>: <描述>`（每 commit 一句，描述对应任务编号与内容，如 `REQ-20260921-order-timeout: T-03 实现超时判定领域服务`）。
5. 每完成一项任务，立即更新 `05-tasks.md`：对应任务复选框置为 `- [x]`，并记录完成日期。
6. 父 Agent 汇总各子代理返回摘要，向用户汇报进度（已完成/进行中/阻塞任务）；遇阻塞时将 `00-meta.md` 的 `status` 置为 `blocked` 并记录原因，待用户解除后恢复 `developing`。

## 产出与状态流转

- 产出文件：源码改动 + 更新的 `requirements/REQ-YYYYMMDD-<slug>/05-tasks.md`
- 状态流转：进入开发置 `developing`；全部任务勾选完成后保持 `developing`，等待 CR。
- 更新 `SUMMARY.md`：追加/更新「开发阶段」摘要（≤5 行），含任务完成数/总数、阻塞项。
- 全部任务完成后提示用户执行 `/cr <需求编号>`。

## 纯档案批 / 实施批的时态纪律（EP-07，强制）

- **纯档案批**（方案、裁定、计数修订等不含代码的批次）：凡描述**尚未实施**的代码一律用将来时，并显式标注「**（本批仅档案：代码待实施、不随本批提交）**」；门禁数字写「**基线（上一变更现状）**…；实现后须复跑并登记新计数」，**禁止**把未跑的用例/门禁写成已通过。
- **代码实施批**：必须**同批**把上一批留下的「待实施」全部翻成事实，并同步计数三件套 —— `08-test-plan` 用例总数 / 类型分布 / 执行状态 + `09-release` 测试执行行。
