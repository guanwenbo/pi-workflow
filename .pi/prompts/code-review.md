---
description: "代码级评审：L1 机械层 + L2 多视角语义评审 + 验证轮，产出 06a-code-review.md；通过后 /cr 才能开始架构师 CR"
argument-hint: "REQ-YYYYMMDD-<slug>"
---
执行 pi-workflow 命令 `/code-review`。

本次调用参数：${@:-（未提供）}

执行前必须先读 `.pi/commands/code-review.md`——它是本命令的权威定义，严格按其中的「前置校验 → 执行流程 → 产出与状态流转」执行，插件工具调用不得省略。
若该文件不存在，说明当前仓尚未接入 pi-workflow：告知用户先执行 `/req-adopt <本仓绝对路径>`，然后停止，不要凭猜测执行。
