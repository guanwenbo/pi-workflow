---
description: 风险管控：派发风险官维护风险登记册（任意阶段可执行，不改变状态）
---

# /risk

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，确认需求档案存在。
   - 若不存在，提示：「需求档案不存在，请先执行 /req-new <需求名>」，停止执行。
2. **任意状态均可执行本命令**（含 blocked、change-requested）；本命令**不改变 status**。
3. `archived` 状态下仅允许查看登记册，不再新增风险项。

## 执行流程

1. 派发 Task 子代理，任务简报：
   - 角色：风险官
   - 任务：识别、评估并维护本需求的风险登记册
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/` 目录下已存在的全部档案（00-meta.md、SUMMARY.md、03-design.md、05-tasks.md、06-cr-report.md、10-risks.md 等）、`workflow/PROFILE.md`、`workflow/templates/10-risks.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/10-risks.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
2. `10-risks.md` 风险登记册表格字段：
   - 风险编号（R-01、R-02…）
   - 风险项描述
   - 概率（高/中/低）
   - 影响（高/中/低）
   - 等级（概率×影响：高×高=紧急，高×中/中×高=高，中×中=中，其余=低）
   - 应对策略（规避/减轻/转移/接受，附具体措施）
   - Owner
   - 状态（open / mitigating / closed）
3. 风险来源：
   - 03-design.md 的「风险初评」小节（设计阶段登记）
   - 06-cr-report.md 中反复出现的问题
   - 05-tasks.md 中延期/阻塞任务
   - 父 Agent 与用户对齐过程中暴露的不确定性
4. 每次执行时：更新既有风险状态、评估等级变化、新增新识别风险；等级为「紧急/高」的 open 风险由父 Agent 单独向用户高亮汇报。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/10-risks.md`
- 状态流转：**不改变 status**，仅更新 `00-meta.md` 的 `updated`。
- 更新 `SUMMARY.md`：在对应阶段摘要中补充高等级风险一句话提示（保持每阶段 ≤5 行）。
