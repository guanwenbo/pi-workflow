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

## 目录结构

| 目录 | 内容 | 变更节奏 |
|---|---|---|
| `docs/` | 流程总说明、角色定义、阶段模板、架构宪法 | 随流程演进 |
| `packages/` | PI-Desktop 插件（`pi-workflow-gates`、`pi-code-review`），各自独立打包为 `.piplug` | 随插件发版 |
| `scripts/` | 仓库级工具脚本：`sync-install.sh`（同步插件到安装目录并生成内嵌脚手架） | 随开发流程演进 |
| `assets/` | 要复制进**被评审项目根**的执行资产：`rules/`（severity 映射 + semgrep 红线）、`scripts/review/`（run-l1.sh） | 随规则/执行器演进 |
| `requirements/` | 需求档案存放区 | 随需求累积 |
| `.pi/commands/` | 斜杠命令定义；**必须留在仓库根**（PI-Desktop 宿主约定） | 随命令演进 |

## 文档索引

| 文档 | 说明 |
|---|---|
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | 工作流总说明与命令速查 |
| [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md) | 父 Agent 总控协议 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构宪法 |
| [docs/SEMANTICS.md](docs/SEMANTICS.md) | 语义口径机制与模板（真实台账落在被评审项目内） |
| [docs/PROFILE.md](docs/PROFILE.md) | 开发者画像 |
| [docs/EVOLUTION.md](docs/EVOLUTION.md) | 流程进化记录 |
| [requirements/README.md](requirements/README.md) | 需求档案规范 |
