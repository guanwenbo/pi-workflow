---
description: 把另一个 git 仓库接入 pi-workflow（同步命令与文档、建 requirements 目录、自检）
---

# /req-adopt

参数：`<目标仓绝对路径>`（必填）

用于「需求要从别的仓承接」的场景：在动 `/req-new` 之前，先让目标仓具备与本仓一致的工作流资产（`.pi/commands`、`docs/`、`requirements/README.md`）。

## 前置校验

无前置状态要求，但执行前必须检查：

1. `<目标仓绝对路径>` 未提供时，提示：「请提供目标仓绝对路径，格式：`/req-adopt /abs/path/to/repo`」，停止执行。
2. 路径必须存在且是 git 仓库（含 `.git`）；否则提示用户确认路径，禁止在非仓库目录里铺文件。
3. 目标仓若已有 `docs/`，工具会先备份为 `.workflow-backup-docs-<时间戳>`；必须把备份路径回报给用户，等用户确认后再删。

## 执行流程

本命令由父 Agent（需求管家）自己执行，**不派发任何角色 Agent**。

**插件可用时（首选）**：调用插件工具 `plugin_gwb_pi_workflow_gates_adopt_project`（参数：`projectPath`=目标仓绝对路径；源资产在插件安装态下会自动用内嵌脚手架，也可用 `sourceRoot` 显式指定 pi-workflow 仓根）。

工具做的事（幂等，重复执行只覆盖同步）：

1. 备份目标仓旧 `docs/`（存在时）；
2. 复制 `.pi/commands` 全部命令；
3. 复制 `.pi/prompts` 全部斜杠入口（宿主 `/` 菜单只认这一层，`.pi/commands` 不进菜单）；
3. 复制 `docs/`（含 `templates/`）；
4. 建 `requirements/` 并放 `README.md`；
5. `.gitignore` 追加 `requirements/.registry.json`（跨项目注册中心的本地镜像，不入库）；
6. 自检模板、命令与斜杠入口在位。

**插件不可用时**：明确告知用户「该操作需要插件 `gwb.pi-workflow-gates` ≥ 0.9.1」，并停止；不允许手工用 `cp` 铺一遍了事（会产生版本漂移）。

## 产出与状态流转

- 工具返回 `checks`（逐项结果）、`needConfirm`（需人工确认项，主要是旧 docs 备份）、`next`。
- 本命令**不改任何需求状态**（目标仓此时还没有需求档案）。
- 返回给用户：目标仓名、逐项检查结果、待确认项，并提示下一步——`cd <目标仓>` 后执行 `/req-new <需求名>` 建档；
  若父需求在本仓且需要目标仓承接，回到本仓执行 `/req-derive <本仓REQ> to <目标仓名>`。
