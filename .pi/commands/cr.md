---
description: 架构师 Agent CR：分级审查改动、循环修复直至无 blocker/major，并生成人工复验交接文档
---

# /cr

参数：`REQ-YYYYMMDD-<slug>`（必填）

## 前置校验

1. 读取 `requirements/REQ-YYYYMMDD-<slug>/00-meta.md`，校验 `status`。
2. 期望状态：`developing`（首次进入或被打回后重进）或 `cr-agent`/`cr-human`（CR 流程续跑）。
   - 若 status 为 `planned` 或更早，提示：「开发尚未完成，请先执行 /dev <需求编号>」，停止执行。
   - 若 status 为 `cr-confirmed`，提示：「CR 已通过人工确认，请先执行 /test-plan <需求编号>」，停止执行。
   - 若 status 为 `testing` 或之后，提示：「需求已进入测试及之后阶段；如需改动，请先执行 /change <变更描述>」，停止执行。
3. 校验 `05-tasks.md` 全部任务已勾选 `- [x]`；存在未完成任务时提示先执行 /dev 完成剩余任务。

## 执行流程

### 第一阶段：Agent CR 循环

1. 父 Agent 更新 `00-meta.md`：`status: cr-agent`，更新 `updated`。
2. 派发 Task 子代理，任务简报：
   - 角色：架构师CR
   - 任务：对照设计稿与架构约束，审查本需求全部代码改动（git diff / 提交记录）
   - 可读文件白名单：`requirements/REQ-YYYYMMDD-<slug>/03-design.md`、`workflow/ARCHITECTURE.md`、`workflow/PROFILE.md`、`workflow/templates/06-cr-report.md`、`requirements/REQ-YYYYMMDD-<slug>/05-tasks.md`、改动涉及的源码
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/06-cr-report.md`（**每轮追加，不覆盖**，标注「第 N 轮」）
   - 返回格式：≤200 字摘要（结论 + 产出路径 + 待决策事项）
3. 审查要点（写入任务简报）：
   - 设计一致性：实现是否符合 03-design.md 的领域模型与三层模块划分映射表
   - 架构硬性规则：单向调用无循环依赖；业务逻辑只在业务层；API层仅入参校验+防腐+参数转化；外部依赖层绝对无业务逻辑；下层无冗余参数校验
   - 提交信息格式：`REQ-YYYYMMDD-<slug>: <描述>`
   - 代码质量：命名、重复代码、错误处理、并发与边界
   - 分布式红线与边界：无单机假设（本地内存缓存/本地文件共享/单机锁/单机定时任务/内存态跨请求）；接口幂等；上下文/接口/事务/数据边界无违规（见 ARCHITECTURE.md 第五、六节）
   - 工程规范：关键路径日志完备（带业务标识、异常带堆栈、敏感信息脱敏）；公共接口与复杂逻辑有 why 注释（见 ARCHITECTURE.md 第七节）
4. 问题按三级分级写入 06-cr-report.md：
   - **blocker**：架构违规 / 功能错误 / 数据安全风险，必须修复
   - **major**：明显质量问题 / 设计偏差，必须修复
   - **minor**：建议性优化，记录即可
5. 循环逻辑：
   - 本轮发现 blocker 或 major → 派发「开发工程师」修复（按 /dev 的派发简报格式，额外附可读文件 06-cr-report.md），提交信息仍为 `REQ-YYYYMMDD-<slug>: <描述>`，并注明「修复 CR 第 N 轮」
   - 修复完成 → 再次派发「架构师CR」复审，追加「第 N+1 轮」
   - 每轮修复计入 `00-meta.md` 的 `metrics.返工次数`，每轮 CR 计入 `metrics.CR轮次`
   - 直至**一整轮无任何 blocker/major**（minor 可遗留并登记），进入编译验证
6. **编译验证（通过门禁，硬性前置）**：派发子代理执行本地构建（按仓库类型自动探测：`mvn -q compile` / `./gradlew compileJava` / `npm run build` / `go build ./...` 等，探测不到则读 README 或询问用户）：
   - 编译失败 → 视为 blocker，派发「开发工程师」修复后重新执行本步骤 + 重新 CR，计入 `metrics.返工次数`
   - 编译成功 + 本轮无 blocker/major → Agent CR 才算通过，将 `status` 从 `cr-agent` 推进为 `cr-human`

### 第二阶段：生成人工复验交接文档

7. 派发 Task 子代理，任务简报：
   - 角色：架构师CR
   - 任务：生成人工复验交接文档，让人工评审者无需翻代码即可定位重点
   - 可读文件白名单：`06-cr-report.md`、`03-design.md`、`05-tasks.md`、全部改动源码、`workflow/templates/07-cr-handoff.md`
   - 产出文件：`requirements/REQ-YYYYMMDD-<slug>/07-cr-handoff.md`
   - 返回格式：≤200 字摘要
8. `07-cr-handoff.md` 必须包含：
   - **改动范围**：文件/模块清单，按功能域分组
   - **入口清单**：API 路由 / 页面路由 / 消息消费 / 定时任务 / 事件监听，逐项标注穿透路径（如 `POST /orders/timeout → API层 OrderController → 业务层 TimeoutService → 外部依赖层 OrderRepository`）
   - **核心流程**：mermaid 时序图或流程图，标注关键分支
   - **重点风险区**：建议人工重点核对的代码段及原因
   - **Agent 已确认项清单**：架构师CR 已逐条确认通过的检查项（人工可免检）
9. 父 Agent 将 07-cr-handoff.md 呈现给用户，等待人工复验结论：
   - **通过** → `status: cr-confirmed`，更新 `updated`
   - **打回** → 将打回原因记录到 `00-meta.md` 的 `metrics.人工打回原因`（追加，含日期），`metrics.返工次数` +1，`status` 回退为 `developing`；待开发修复后重新执行本命令（/cr）

## 产出与状态流转

- 产出文件：
  - `requirements/REQ-YYYYMMDD-<slug>/06-cr-report.md`（每轮追加）
  - `requirements/REQ-YYYYMMDD-<slug>/07-cr-handoff.md`
- 状态流转：`developing → cr-agent →（循环修复）→ cr-human → cr-confirmed`；打回时 `cr-human → developing`。
- 更新 `00-meta.md` 的 `metrics.CR轮次`、`metrics.返工次数`、`metrics.人工打回原因`。
- 更新 `SUMMARY.md`：追加「CR 阶段」摘要（≤5 行），含 CR 轮次、blocker/major/minor 数量、人工复验结论。
- cr-confirmed 后提示用户执行 `/test-plan <需求编号>`。
