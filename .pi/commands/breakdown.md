---
description: 任务拆解：派发计划工程师将设计稿拆为 WBS 任务表
---

# /breakdown

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`reviewed`（或 `planned`，表示重新拆解）。
   - 若 status 为 `designing` 或更早，提示：「设计尚未评审通过，请先执行 /review <需求编号>」，停止执行。
   - 若 status 为 `developing` 或之后，提示：「任务已进入开发（当前状态：<status>）；如需调整任务，请先执行 /change <变更描述>」，停止执行。
3. 校验 `03-design.md` 存在；缺失时提示先执行 /design。

## 执行流程

1. 派发 Task 子代理，任务简报：
   - 角色：计划工程师
   - 任务：将评审通过的设计稿拆解为可执行的 WBS 任务表
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`requirements/REQ-YYYYMMDD-<slug>/04-review.md`、`workflow/ARCHITECTURE.md`、`workflow/PROFILE.md`、`workflow/templates/05-tasks.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/05-tasks.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
2. `05-tasks.md` WBS 任务表要求：
   - 任务编号：T-01、T-02…，按三层结构分组（API层 / 业务层 / 外部依赖层），同层内按聚合/模块分组
   - 每行字段：任务编号 | 任务描述 | 负责角色 | 工时估算（人时） | 依赖任务编号 | 里程碑
   - 依赖关系必须遵守架构单向调用约束（外部依赖层任务不依赖上层任务），禁止出现环
   - 里程碑建议：M1 外部依赖层完成、M2 业务层完成、M3 API层与联调完成
   - 每项任务带复选框 `- [ ]`，供 /dev 阶段勾选
3. 拆解完成后父 Agent 向用户汇报任务总数、总工时、关键路径与里程碑排期，供用户确认。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/05-tasks.md`
- 状态流转：修改 `00-meta.md` 的 `status: planned`，更新 `updated`。
- 更新 `SUMMARY.md`：追加「拆解阶段」摘要（≤5 行），含任务总数、总工时、里程碑。
- 提示用户下一步执行 `/dev <需求编号>`。
