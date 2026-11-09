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

### 方式 A：安装打包好的插件（推荐给使用者）

1. 拿到 `gwb.pi-workflow-gates-<版本>.piplug`（由维护者用 `PluginPack` 打成，见方式 C）。
2. PI-Desktop → **Plugins** 页面 → **Install package** → 选择该 `.piplug` → 启用。
3. 重启窗口或重载插件。此时：
   - `/` 菜单的「提示词模板」组出现 `/req-new` `/req-derive` 等 15 条命令（写入 `~/.pi/agent/prompts`，全局生效）；
   - 命令面板里出现「打开需求看板」；
   - Agent 工具多出 `req_init` / `adopt_project` / `req_derive` 等 10 个。
4. 在要跑需求的仓里执行 `/req-adopt <该仓绝对路径>` 接入该仓，然后 `/req-new` 建档。

### 方式 B：从源码加载（推荐给维护者/改造者）

1. `git clone git@github.com:guanwenbo/pi-workflow.git`
2. PI-Desktop → Plugins → **Load development plugin** → 指向 `pi-workflow/packages/pi-workflow-gates`。
3. 改完代码保存即热加载；提交前跑 `node packages/pi-workflow-gates/test/smoke.js` 与 `packed-install.js`。

### 方式 C：自己打包分发

```bash
node scripts/build-scaffold.js   # 重建内嵌脚手架（改了 .pi/commands 或 docs 必须重跑，否则分发包是旧内容）
bash scripts/sync-install.sh     # 同步本机安装副本（会顺带重建脚手架）
# 然后用 PI-Desktop 的 PluginPack 对该目录打包，产物在 packages/pi-workflow-gates/dist/
```

`.pi/commands` 或 `docs/` 有改动却没重建脚手架时，分发包里的命令仍是旧版——`node scripts/build-scaffold.js --check` 可校验是否过期。
