---
description: "测试执行与用例回归：执行设计期产出的测试用例并回填结果（用例本身在 /design 阶段产出）"
argument-hint: "REQ-YYYYMMDD-<slug>"
---
执行 pi-workflow 命令 `/test-plan`。

本次调用参数：${@:-（未提供）}

执行前必须先读 `.pi/commands/test-plan.md`——它是本命令的权威定义，严格按其中的「前置校验 → 执行流程 → 产出与状态流转」执行，插件工具调用不得省略。
若该文件不存在，说明当前仓尚未接入 pi-workflow：告知用户先执行 `/req-adopt <本仓绝对路径>`，然后停止，不要凭猜测执行。
