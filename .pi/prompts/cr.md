---
description: "架构师 Agent CR：分级审查改动、循环修复直至无 blocker/major，并生成人工复验交接文档"
argument-hint: "REQ-YYYYMMDD-<slug>"
---
执行 pi-workflow 命令 `/cr`。

本次调用参数：${@:-（未提供）}

执行前必须先读 `.pi/commands/cr.md`——它是本命令的权威定义，严格按其中的「前置校验 → 执行流程 → 产出与状态流转」执行，插件工具调用不得省略。
若该文件不存在，说明当前仓尚未接入 pi-workflow：告知用户先执行 `/req-adopt <本仓绝对路径>`，然后停止，不要凭猜测执行。
