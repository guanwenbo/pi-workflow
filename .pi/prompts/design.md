---
description: "方案设计：派发架构设计师产出 DDD 设计稿，并同步派发测试工程师产出测试计划（供开发参考边界场景）"
argument-hint: "REQ-YYYYMMDD-<slug>"
---
执行 pi-workflow 命令 `/design`。

本次调用参数：${@:-（未提供）}

执行前必须先读 `.pi/commands/design.md`——它是本命令的权威定义，严格按其中的「前置校验 → 执行流程 → 产出与状态流转」执行，插件工具调用不得省略。
若该文件不存在，说明当前仓尚未接入 pi-workflow：告知用户先执行 `/req-adopt <本仓绝对路径>`，然后停止，不要凭猜测执行。
