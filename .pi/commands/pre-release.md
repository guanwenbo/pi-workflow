---
description: 上线检查：派发发布工程师执行发布 Checklist 并产出发布档案
---

# /pre-release

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`testing`（或 `ready-release`，表示更新发布档案）。
   - 若 status 为 `cr-confirmed` 或更早，提示：「测试尚未完成，请先执行 /test-plan <需求编号>」，停止执行。
   - 若 status 为 `released`/`archived`，提示：「需求已发布（当前状态：<status>）；如需变更，请先执行 /change <变更描述>」，停止执行。
3. 校验 `08-test-plan.md` 存在；缺失时提示先执行 /test-plan。

## 执行流程

1. 派发 Task 子代理，任务简报：
   - 角色：发布工程师
   - 任务：逐项执行发布 Checklist，输出发布档案
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`、`requirements/REQ-YYYYMMDD-<slug>/07-cr-handoff.md`、`requirements/REQ-YYYYMMDD-<slug>/10-risks.md`（若存在）、`workflow/PROFILE.md`、`workflow/templates/09-release.md`、仓库配置与部署相关文件
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/09-release.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
2. `09-release.md` 发布 Checklist（逐项标注 就绪/未就绪/不适用，未就绪项必须给出处理方案与 Owner）：
   - **配置项**：新增/变更的配置键、环境差异、默认值
   - **DB 迁移脚本**：脚本清单、执行顺序、是否可重入、数据回填说明
   - **回滚方案**：回滚步骤、回滚后数据兼容性、回滚验证方式
   - **监控告警**：新增指标/告警规则、看板链接、告警接收人
   - **灰度策略**：灰度范围、放量节奏、熔断/止损条件
   - **依赖服务确认**：上下游服务版本、联调结论、依赖方确认记录
3. 存在「未就绪」项时，父 Agent 向用户汇报并等待处理；可将 `00-meta.md` 的 `status` 置为 `blocked` 并记录原因。
4. 全部项就绪后，父 Agent 更新 `00-meta.md`：`status: ready-release`，更新 `updated`，并向用户申请发布许可。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/09-release.md`
- 状态流转：Checklist 全部就绪后置 `ready-release`；未就绪时可置 `blocked`。
- 更新 `SUMMARY.md`：追加「发布阶段」摘要（≤5 行），含 Checklist 就绪情况、灰度策略、回滚方案要点。
- 发布执行由用户确认后线下/外部流程完成；用户确认发布完成后，父 Agent 将 `status` 置为 `released`，并提示执行 `/retro <需求编号>`。

## 过程纪律（EP-07）

- 发布评审前核对 `00-meta.md` 账本：`CR 轮次` 是否等于 `06-cr-report.md` 最后一条（不是 +1）；`返工次数` 是否按「每次不通过计 1」且写有可核算式；EP-05 代码 CR 是否被误计入档案链返工。
- 核对 `08-test-plan` / `09-release` 的计数与实际执行是否一致（含上批「基线…实现后须复跑」是否已复跑并登记新计数）。
