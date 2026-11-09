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
| `~/.pi/agent/prompts/` | **`/` 菜单的提示模板**（用户级，全局生效）——由插件加载时从 `.pi/commands` 自动生成，不需要任何命令 | 插件版本驱动 |

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

## 给别人用：插件安装

插件 `gwb.pi-workflow-gates` 自带一份工作流脚手架（`.pi/commands` + `docs/`，构建产物 `scaffold.generated.js`），
所以**装完即可用**：斜杠命令自动进 `/` 菜单，接入新仓只需一条命令，不依赖本仓库路径。

### 方式 A：安装 tag 版本（推荐给使用者）

1. 打开 https://github.com/guanwenbo/pi-workflow/releases → 选一个 **`vX.Y.Z` tag**（不要用 main 上的临时产物）。
2. 下载该 Release 的附件 `gwb.pi-workflow-gates-<版本>.piplug`。
3. PI-Desktop → **Plugins** 页面 → **Install package** → 选该文件 → 启用。
4. 重启窗口或重载插件。此时：
   - `/` 菜单的「提示词模板」组出现 `/req-new` `/req-derive` 等 15 条命令（写入 `~/.pi/agent/prompts`，全局生效）；
   - 命令面板出现「打开需求看板」与「检查 PI-Workflow 插件更新」；
   - Agent 工具多出 `req_init` / `adopt_project` / `req_derive` / `check_update` 等 11 个。
5. 在要跑需求的仓里执行 `/req-adopt <该仓绝对路径>` 接入该仓，然后 `/req-new` 建档。

### 自动更新

- 插件加载时（24 小时最多一次）读仓库 main 分支的 `latest.json` 比对版本；落后就在界面上提示「有新版本」。
- 命令面板执行 **「检查 PI-Workflow 插件更新」**：强制检查并把新版 `.piplug` 下载到 `~/Downloads`，随后在 Plugins 页面 Install package 即可完成升级。
- 宿主没有给插件「静默安装」API，所以最后一步安装必须由人点——这是宿主的安全边界，不是可以绕过的限制。
- 不想联网检查：插件设置里置 `autoUpdateCheck: false`（或让 Agent 调 `check_update` 以外的功能即可，它不影响任何本地功能）。

### 方式 B：从源码加载（推荐给维护者/改造者）

1. `git clone git@github.com:guanwenbo/pi-workflow.git`
2. PI-Desktop → Plugins → **Load development plugin** → 指向 `pi-workflow/packages/pi-workflow-gates`。
3. 改完保存即热加载；提交前跑三个测试：`smoke.js`、`packed-install.js`、`update-check.js`。

### 方式 C：发版（维护者）

```bash
# 1. 改 packages/pi-workflow-gates/manifest.json 的版本号（如 0.9.5）
# 2. 打包前必须先重建内嵌脚手架，否则分发包里是旧命令/旧文档
node scripts/build-scaffold.js
# 3. 在 PI-Desktop 对该目录执行 PluginPack，产物在 dist/
# 4. 一条命令完成：校验 + 测试 + 更新 latest.json + 打 tag + 推送 + 建 Release 并上传附件
bash scripts/release.sh
```

发版纪律：**每个版本必须有 `vX.Y.Z` tag**，使用方只认 tag 对应的 Release 附件；`latest.json` 由 `release.sh` 自动重写，是自动更新的唯一数据源。
`node scripts/build-scaffold.js --check` 可校验脚手架是否过期。
