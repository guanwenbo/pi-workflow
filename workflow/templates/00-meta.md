---
id: REQ-YYYYMMDD-<slug>
title: <需求标题>
status: draft
priority: <P0|P1|P2|P3>
owner: <负责人>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# 元信息 — <需求标题>

<!-- 本文件对应需求档案中的 00-meta.md，记录需求全生命周期的元信息与过程数据。frontmatter 中的 status 必须随时与状态机保持同步。 -->

## 过程指标 metrics

<!-- 每完成一个阶段即更新本表，供复盘（11-retro.md）提取数据。 -->

| 指标 | 数值 | 备注 |
| --- | --- | --- |
| 阶段耗时 | <如：澄清 2h / 设计 4h / 开发 2d> | |
| 返工次数 | <次数> | <哪个阶段返工> |
| CR 轮次 | <轮数> | |
| 人工打回原因 | <原因摘要> | <打回阶段> |

## 状态变更日志

<!-- 每次状态迁移追加一行；状态机：draft → clarifying → clarified → designing → reviewed → planned → developing → cr-agent → cr-human → cr-confirmed → testing → ready-release → released → archived；异常状态：blocked、change-requested。 -->

| 时间 | 从状态 | 到状态 | 操作人 | 备注 |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD HH:mm | draft | clarifying | <姓名/Agent> | <备注> |
