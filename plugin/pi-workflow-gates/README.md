# PI-Workflow Gates

pi-workflow 的**机械层门禁插件**：把「建档 / 状态机 / 账本」从 Markdown 软约束下沉为代码物理执行。判断类工作（设计、评审、CR）仍由角色 Agent 在 Markdown 规则下承担——软硬分层。

## 提供的 Agent 工具

| 工具 | 作用 | 风险 |
|---|---|---|
| `req_init` | 创建需求档案：生成编号、建目录、拷贝模板、填 frontmatter；重复建档拒绝 | medium |
| `state_check` | 命令前置状态校验，ok=false 附「请先执行 /xxx」话术 | low |
| `state_transition` | 状态流转：按状态机邻接表校验，非法流转物理拒绝；自动写 frontmatter + 状态变更日志 | medium |
| `layer_scan` | 分层与域间依赖物理扫描（Java import 分析）：①下层调上层 ②域间直接调用（组装层豁免）③类级循环依赖；支持增量（传改动文件）、SPI 豁免（allow）、默认排除 src/test | low |
| `chg_next` | 变更编号自增：读 CHANGES.md 返回最大 CHG-NN + 1 | low |
| `metrics_record` | EP-07 账本：CR 轮次/返工次数/人工打回原因，写 `N = N-1 + 1` 可核算式；人工打回联动返工 +1 | medium |

## 文件操作范围（manifest fs 声明）

- 读：`requirements/**`、`workflow/**`（当前打开的工作区）
- 写：仅 `requirements/**`
- 不访问网络，不删文件，不碰代码

## 与命令的关系

`.pi/commands/` 的 12 个命令在插件可用时必须先走对应插件工具（见 `workflow/ORCHESTRATOR.md` 门禁执行段）；插件不可用时才走手工兜底。

## 安装

- 开发模式：在 pi-workflow 工作区内打开本目录即热加载
- 其他项目：复制本目录到 `~/.pi-desktop/plugins/installed/gwb.pi-workflow-gates/` 并在 `registry.json` 注册（或经 PluginPack 打包安装）
