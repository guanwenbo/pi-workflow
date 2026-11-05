# assets —— 要复制进被评审项目的执行资产

这里的两个目录在本仓库只是**模板**；只有在**被评审项目根**才成为运行时路径：

| 仓库内 | 复制到被评审项目 | 用途 |
|---|---|---|
| `assets/rules/` | `rules/` | `severity.json`（严重度映射，`cr_ingest` 读取；缺省用插件内置默认）、`semgrep/`（自有红线规则） |
| `assets/scripts/review/` | `scripts/review/` | `run-l1.sh`（diff 落盘 + 11 个工具 + `status.json`）与 `lib/pom-inject.sh`（评审期临时注入/回滚） |

复制（目标已有同名文件时先 `diff` 再合并，不要盲目覆盖）：

```bash
cp -R assets/rules            <被评审项目>/rules
mkdir -p <被评审项目>/scripts
cp -R assets/scripts/review  <被评审项目>/scripts/review
```

复制完成后，在被评审项目根执行：

```bash
scripts/review/run-l1.sh --req REQ-YYYYMMDD-<slug> --round 1 --verify-inject   # 先秒级自检注入/回滚
scripts/review/run-l1.sh --req REQ-YYYYMMDD-<slug> --round 1                   # 再正式跑
```

## 为什么不在插件包里

- 平台硬约束：插件**不执行进程**，L1 只能由 Agent 的 Bash 跑。
- 插件目录保持自包含（`manifest.json` + `main.js`），`PluginPack` 只打这两个，不夹带脚本与规则。
- 规则会随团队红线单独演进，发版节奏与插件不同；放 `assets/` 可以只更新规则、不重发插件。
