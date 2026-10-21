---
description: 方案设计：派发架构设计师产出 DDD 设计稿，并同步派发测试工程师产出测试计划（供开发参考边界场景）
---

# /design

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`clarified`（或 `designing`，表示继续修订设计）。
   - 若 status 为 `draft`/`clarifying`，提示：「需求尚未澄清，请先执行 /req-clarify <需求编号>」，停止执行。
   - 若 status 为 `reviewed` 或之后，提示：「设计已评审通过（当前状态：<status>），请先执行 /breakdown <需求编号>」，停止执行；如因变更需重新设计，须先执行 `/change <变更描述>`。
3. 校验 `02-clarification.md` 存在且含 AC（Given/When/Then）；缺失时提示先完成 /req-clarify。

## 执行流程

1. 父 Agent 先更新 `00-meta.md`：`status: designing`，更新 `updated`。
2. 探测仓库技术栈：依次查找 `package.json`、`go.mod`、`pom.xml`、`build.gradle`、`Cargo.toml`、`requirements.txt` 等，确定语言/框架/构建工具；探测不到时再向用户提问，不得擅自假设。
3. 派发 Task 子代理，任务简报：
   - 角色：架构设计师
   - 任务：基于澄清定稿产出设计稿，严格遵守 DDD 与三层架构约束
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`、`workflow/ARCHITECTURE.md`、`workflow/PROFILE.md`、`workflow/templates/03-design.md`、技术栈探测结果
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/03-design.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
4. **架构师方案评审（门禁，EP-03）**：设计稿产出后，派发 Task 子代理做**方案评审**：
   - 角色：架构师CR（cr-architect）；模型：`custom/gpt-6-sol`（HC-13 强制显式指定）
   - 任务：对 `03-design.md` 做架构级方案评审（评审对象是方案，不是代码）；评审意见**追加到 `03-design.md` 末尾「架构师评审意见」章节**
   - 简报必须写明判定纪律：只有功能错误/资损/数据不一致/幂等并发失效/违反架构硬性规则判 blocker|major；用户已决策事项不得判 blocker|major，只能记「接受风险 + 上线前置条件」
   - 不通过 → 按问题清单修订设计稿后复评（同一方案最多复评 2 轮，未收敛上报用户决策）；**通过后才可提示用户执行 `/review`**
5. `03-design.md` 必须包含以下全部小节（含「配置清单」「架构师评审意见」章节）：
   - **领域模型（DDD）**：限界上下文划分、聚合根、实体与值对象、领域事件
   - **三层模块划分映射表**：领域对象/功能 → API层 / 业务层 / 外部依赖层 的模块落位表
   - **技术选型**：框架、库、中间件及选型理由
   - **架构图**：mermaid 图（组件图或部署图）
   - **数据模型**：表结构/字段/索引
   - **接口契约**：API 路由、出入参、错误码
   - **非功能需求**：性能、安全、兼容性指标
   - **风险初评**：初步识别的技术风险（供 /risk 登记）
6. 架构硬性约束（写入任务简报，要求设计师逐条遵守）：
   - 单向调用：API层 → 业务层 → 外部依赖层，禁止循环依赖
   - 业务逻辑只能写在业务层；API层只做入参校验+防腐+参数转化；外部依赖层只做参数转化+防腐且绝对无业务逻辑
   - 下层不做冗余参数校验
   - 设计文档纪律：03-design.md 正文始终只保留最终态，不写过程结论（变更/修订过程记 changes/CHANGES.md 与评审/CR 报告），确保代码与设计 1:1 还原
   - 详见 `workflow/ARCHITECTURE.md`
7. 设计稿完成后，**同步派发测试工程师**（任务简报）：
   - 角色：测试工程师
   - 任务：基于设计稿与验收标准产出测试计划，供开发阶段参考边界场景
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/02-clarification.md`、刚产出的 `03-design.md`、`workflow/PROFILE.md`、`workflow/templates/08-test-plan.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`
   - 返回格式：≤200 字摘要
8. `08-test-plan.md` 要求：每条 AC 至少 1 条用例（用例编号 TC-001…，字段：编号/类型[正常|边界|异常|回归]/前置条件/步骤/预期/关联 AC）；**边界与异常用例必须对照设计稿的「边界定义」「分布式设计」章节推导**；末尾附 AC 覆盖矩阵，存在未覆盖 AC 必须补齐。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/03-design.md` + `requirements/REQ-YYYYMMDD-<slug>/08-test-plan.md`
- 状态流转：进入设计时置 `designing`；设计稿与测试计划完成后**先派发架构师方案评审（EP-03 门禁）**，评审通过后保持 `designing`，等待 `/review`；未通过则修订后复评（同一方案最多复评 2 轮，未收敛上报用户决策）。
- 更新 `SUMMARY.md`：追加「设计阶段」摘要（≤5 行），含限界上下文清单、三层映射要点、用例总数与 AC 覆盖率、待决策项。
- 提示用户下一步执行 `/review <需求编号>`。
