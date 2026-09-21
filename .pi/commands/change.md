---
description: 变更管理：创建变更单、评估影响，审批后回流受影响阶段
---

# /change

参数：`REQ-YYYYMMDD-<slug> <变更描述>`（均必填）

## 前置校验

1. 若参数缺失，提示：「格式：`/change REQ-YYYYMMDD-<slug> <变更描述>`」，停止执行。
2. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，确认需求档案存在；不存在时提示先执行 /req-new。
3. 若 status 为 `archived`，提示：「需求已归档，如需变更请执行 /req-new 创建新需求并关联原编号」，停止执行。
4. 其余**任意状态均可发起变更**；发起前记录原状态，供审批通过后回流使用。

## 执行流程

1. 确定变更单编号：扫描 `requirements/REQ-YYYYMMDD-<slug>/changes/` 下已有的 `CHG-NN.md`，编号自增（首个为 `CHG-01`）。
2. 派发 Task 子代理，任务简报：
   - 角色：风险官
   - 任务：创建变更单，完成影响分析
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/` 目录下已存在的全部档案、`workflow/PROFILE.md`、`workflow/templates/CHG-NN.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/changes/CHG-NN.md`
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
3. `changes/CHG-NN.md` 内容要求：
   - 变更编号、提出日期、变更描述（原样记录用户输入）
   - **变更原因**
   - **影响分析**：影响范围（涉及的档案文件/代码模块/任务编号）、工期影响（基于 05-tasks.md 工时重估）、风险影响（新增/升级的风险，同步登记到 10-risks.md）
   - **受影响阶段判定**：列出需回流的阶段（如 clarified → 需重跑 /design；developing → 需重跑 /dev 与 /cr）
   - **审批结论**：留空待用户填写（批准/拒绝 + 日期 + 备注）
4. 父 Agent 更新 `00-meta.md`：`status: change-requested`，更新 `updated`，并将变更单全文呈现给用户审批。
5. 用户审批后：
   - **批准** → 在 CHG-NN.md 填写审批结论；父 Agent 按「受影响阶段判定」将 status 回退到对应阶段的状态（如回到 `clarified`/`designing`/`developing`），并明确提示用户下一步执行哪个命令（如「请执行 /design <需求编号>」）
   - **拒绝** → 在 CHG-NN.md 填写拒绝结论；status 恢复为变更前的原状态
6. 变更引起的返工计入 `00-meta.md` 的 `metrics.返工次数`。

## 产出与状态流转

- 产出文件：`requirements/REQ-YYYYMMDD-<slug>/changes/CHG-NN.md`；必要时更新 `10-risks.md`
- 状态流转：发起时置 `change-requested`；审批批准后回退到受影响阶段状态，拒绝则恢复原状态。
- 更新 `SUMMARY.md`：追加「变更 CHG-NN」摘要（≤5 行），含变更原因、影响范围、审批结论。
