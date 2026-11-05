# pi-workflow

企业级应用需求承接工作流 —— 运行在 PI-Desktop 上的多角色 Agent 协作体系。

## 快速开始

1. 用 PI-Desktop 打开本仓库
2. 输入 `/req-new <需求名>` 创建需求档案
3. 按流程推进：`/req-clarify → /design → /review → /breakdown → /dev → /code-review → /cr → /test-plan → /pre-release → /retro`

## 体系结构

- **父 Agent 总控**：唯一与用户对话，维护状态机，派发任务简报
- **12 个角色 Agent**：需求分析师 / 架构设计师 / 评审员 / 计划工程师 / 开发工程师 / 架构师CR / 代码评审员 / 代码评审验证官 / 测试工程师 / 发布工程师 / 风险官 / 复盘主持
- **架构宪法**：设计层严格 DDD，实现层分层架构（默认 `API 层 → 业务层 → 领域层 → 外部依赖层`，**层数上限 5 层**），上层调下层、同层跨子域禁止互调、禁止循环依赖
- **自我进化**：每个需求复盘产出流程优化提案，沉淀个人编码习惯

## 文档索引

| 文档 | 说明 |
|---|---|
| [workflow/WORKFLOW.md](workflow/WORKFLOW.md) | 工作流总说明与命令速查 |
| [workflow/ORCHESTRATOR.md](workflow/ORCHESTRATOR.md) | 父 Agent 总控协议 |
| [workflow/ARCHITECTURE.md](workflow/ARCHITECTURE.md) | 架构宪法 |
| [workflow/SEMANTICS.md](workflow/SEMANTICS.md) | 语义口径机制与模板（真实台账落在被评审项目内） |
| [workflow/PROFILE.md](workflow/PROFILE.md) | 开发者画像 |
| [workflow/EVOLUTION.md](workflow/EVOLUTION.md) | 流程进化记录 |
| [requirements/README.md](requirements/README.md) | 需求档案规范 |
