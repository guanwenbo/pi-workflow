#!/usr/bin/env node
/**
 * design_lint / trace_matrix 回归测试。
 * 造一份「典型坏文档」，断言每条判据都能报出来、且解析不串行。
 * 运行：node packages/pi-workflow-gates/test/lint.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "piw-lint-"));
const REQ = "REQ-20260101-demo";
const DIR = path.join(TMP, "requirements", REQ);
fs.mkdirSync(DIR, { recursive: true });
process.env.HOME = path.join(TMP, "home");
fs.mkdirSync(path.join(process.env.HOME, ".pi", "agent", "prompts"), { recursive: true });

const abs = p => (path.isAbsolute(p) ? p : path.join(TMP, p));
global.pi = {
  fs: {
    readText: async p => fs.readFileSync(abs(p), "utf8"),
    writeText: async (p, c) => { const f = abs(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); return true; },
    stat: async p => { const s = fs.statSync(abs(p)); if (s.isDirectory()) throw new Error("dir"); return { isDirectory: false }; },
    list: async p => fs.readdirSync(abs(p), { withFileTypes: true }).map(e => ({ name: e.name, isDirectory: e.isDirectory(), path: p + "/" + e.name })),
    glob: async () => [],
  },
  plugin: { getDataPath: async () => path.join(TMP, "data"), getSettings: async () => ({}), getManifest: () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")) },
  workspace: { get: async () => ({ path: TMP }) },
  agent: { registerTool: async () => {}, unregisterTool: async () => {} },
  commands: { register: async () => {}, unregister: async () => {} },
  ui: { openPanel: async () => {}, showToast: async () => {} },
};

fs.writeFileSync(path.join(DIR, "02-clarification.md"),
  "## 验收标准（AC）\n\n### AC-01\n重复请求只发一张券\n\n### AC-02 金额上限\n");
fs.writeFileSync(path.join(DIR, "05-tasks.md"),
  "| 任务编号 | 任务 | 覆盖AC | verify 命令 | 状态 |\n| --- | --- | --- | --- | --- |\n| T-01 发券接口 | 实现 | AC-01 |  | [x] |\n");
fs.writeFileSync(path.join(DIR, "03-design.md"), `# 设计
## 一、需求背景
本次通过范围权威服务统一发券，从而提升一致性。为了更好的体验还做了很多优化。这段话故意写长用来验证段落句数检查。第四句也应该被算进去。

## 二、业务流程
无

## 三、领域划分
无

## 四、实体设计
无

## 五、数据建模
无

## 六、落地实现
新增 CouponIssueService，改动发券接口。

## 七、边界场景
无

## 附：架构师评审意见
上一轮没通过
`);

let passed = 0;
const ok = m => { passed++; console.log("  ✔ " + m); };

(async () => {
  const plugin = require(path.join(__dirname, "..", "main.js"));
  const T = {};
  global.pi.agent.registerTool = async t => { T[t.name] = t; };
  await plugin.onLoad();

  const r = await T.design_lint.execute({ reqId: REQ, mode: "block" });
  const codes = r.findings.map(f => f.code);
  assert.strictEqual(r.ok, false, "block 模式下有 blocker 应 ok=false");
  for (const c of ["process-content", "link-table-missing", "terms-missing", "reuse-missing", "bare-id", "no-logging"]) {
    assert.ok(codes.includes(c), `应报出 ${c}`);
  }
  ok("block 模式拦下过程内容/缺链路表/缺术语表/缺复用论证/裸编号/无日志");

  const warn = await T.design_lint.execute({ reqId: REQ, mode: "warn" });
  assert.strictEqual(warn.ok, true, "warn 模式只告警不拦");
  assert.ok(warn.counts.blocker > 0);
  ok("warn 模式不拦截，但计数照报");

  const m = await T.trace_matrix.execute({ reqId: REQ });
  assert.strictEqual(m.acs[0].ac, "AC-01");
  assert.strictEqual(m.acs[0].name, "重复请求只发一张券", "名称写在标题下一行时也要读到");
  assert.deepStrictEqual(m.acs[0].tasks, ["T-01"], "任务编号只取编号，不能带任务名");
  assert.deepStrictEqual(m.gaps.acNoTask, ["AC-02"]);
  assert.deepStrictEqual(m.gaps.taskNoVerify, ["T-01"]);
  assert.deepStrictEqual(m.gaps.taskNoEvidence, ["T-01"]);
  ok("trace_matrix：AC 名称跨行解析、任务 ID 归一、缺口准确");

  console.log(`\n全部通过：${passed} 项断言组（临时目录 ${TMP}）`);
})().catch(e => {
  console.error("\n✘ 测试失败：", e && e.message);
  process.exit(1);
});
