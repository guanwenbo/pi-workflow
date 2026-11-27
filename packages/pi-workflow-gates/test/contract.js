#!/usr/bin/env node
/**
 * 命令模板契约测试（docs-as-tests）。
 *
 * 为什么：2026-11 出过「工具都做完了，但 8 个命令模板一个都没调用」——工具数断言全绿，
 * 实际门禁不生效。这里把「命令必须引用什么工具 / 不得出现什么词」变成机检。
 *
 * 运行：node packages/pi-workflow-gates/test/contract.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const ROOT = path.resolve(__dirname, "../../..");
const CMD_DIR = path.join(ROOT, ".pi/commands");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "piw-contract-"));
process.env.HOME = path.join(TMP, "home");
fs.mkdirSync(path.join(process.env.HOME, ".pi", "agent", "prompts"), { recursive: true });
fs.mkdirSync(path.join(TMP, "ws"), { recursive: true });

// 命令 → 必须出现的工具（改流程时同步改这里，这就是契约）
const REQUIRED = {
  "req-new.md": ["req_init"],
  "req-clarify.md": ["state_check"],
  "design.md": ["state_check", "design_lint", "dispatch_record"],
  "review.md": ["design_lint", "trace_matrix"],
  "dev.md": ["analyze", "verify_record", "dispatch_record"],
  "cr.md": ["converge", "trace_matrix"],
  "test-plan.md": ["trace_matrix", "verify_record"],
  "retro.md": ["spec_merge", "rework_top"],
  "req-derive.md": ["req_derive", "answer_return"],
};

// 这些工具属于别的插件，出现在命令里也是合法的
const EXTERNAL_TOOLS = new Set(["cr_gate", "cr_begin", "cr_ingest", "cr_report", "cr_rule", "cr_baseline", "cr_profile"]);

// 禁语：流程文档不该出现的模糊表述（会让 agent 自己发挥）
const BANNED = ["大概", "应该是没问题", "你懂的", "随便", "自己看着办"];

// 体积上限从 checks 的 LIMITS 取，避免阈值散落两处
const { LIMITS } = require("../checks.js");
const MAX_BYTES = LIMITS.commandMaxBytes;

let passed = 0;
const ok = m => { passed++; console.log("  ✔ " + m); };

(async () => {
  const plugin = require(path.join(__dirname, "..", "main.js"));
  const tools = new Set();
  global.pi = {
    fs: {
      readText: async () => { throw new Error("no fs"); },
      writeText: async () => true,
      stat: async () => { throw new Error("no"); },
      list: async () => [],
      glob: async () => [],
    },
    plugin: { getDataPath: async () => TMP, getSettings: async () => ({ autoUpdateCheck: false }), getManifest: () => ({ version: "0.0.0" }) },
    workspace: { get: async () => ({ path: path.join(TMP, "ws") }) },
    agent: { registerTool: async t => { tools.add(t.name); }, unregisterTool: async () => {} },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {}, showToast: async () => {} },
  };
  await plugin.onLoad();
  assert.ok(tools.size >= 20, `工具应至少 20 个，实际 ${tools.size}`);
  ok(`插件注册工具 ${tools.size} 个`);

  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".md"));

  // 1) 必引工具
  for (const [file, need] of Object.entries(REQUIRED)) {
    const p = path.join(CMD_DIR, file);
    assert.ok(fs.existsSync(p), `缺少命令模板 ${file}`);
    const body = fs.readFileSync(p, "utf8");
    const missing = need.filter(t => !body.includes(t));
    assert.strictEqual(missing.length, 0, `${file} 未调用 ${missing.join("、")}（工具存在但流程不触发）`);
  }
  ok(`关键命令都调用了对应工具（${Object.keys(REQUIRED).length} 条命令）`);

  // 2) 引用即存在：模板里出现的 snake_case 工具名必须真实注册
  const pattern = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;
  const bogus = [];
  for (const file of files) {
    const body = fs.readFileSync(path.join(CMD_DIR, file), "utf8");
    for (const m of body.matchAll(pattern)) {
      // 模板里可能写宿主暴露的全名 plugin_gwb_pi_workflow_gates_xxx，剥掉前缀再校验
      const name = m[1].replace(/^plugin_gwb_pi_workflow_gates_/, "");
      if (tools.has(name) || EXTERNAL_TOOLS.has(name)) continue;
      // 允许明确的非工具标识（文件/字段/枚举）
      if (/^(managed_by|plugin_version|updated_at|created_at|reviews?_|changes?_|requirements?_|deferred_work)/.test(name)) continue;
      bogus.push(`${file}: ${name}`);
    }
  }
  assert.deepStrictEqual(bogus, [], `模板引用了不存在的工具：\n    ${bogus.join("\n    ")}`);
  ok("模板里引用的工具名全部真实存在（无幽灵工具）");

  // 3) 禁语
  const hits = [];
  for (const file of files) {
    const body = fs.readFileSync(path.join(CMD_DIR, file), "utf8");
    for (const w of BANNED) if (body.includes(w)) hits.push(`${file}: ${w}`);
  }
  assert.deepStrictEqual(hits, [], `出现禁语：${hits.join("、")}`);
  ok("命令模板无模糊表述");

  // 4) 体积与结构
  const tooBig = [];
  const noFront = [];
  for (const file of files) {
    const p = path.join(CMD_DIR, file);
    const body = fs.readFileSync(p, "utf8");
    if (Buffer.byteLength(body) > MAX_BYTES) tooBig.push(`${file}(${Buffer.byteLength(body)}B)`);
    if (!body.startsWith("---\ndescription:")) noFront.push(file);
  }
  assert.deepStrictEqual(tooBig, [], `模板超体积上限 ${MAX_BYTES}B：${tooBig.join("、")}`);
  assert.deepStrictEqual(noFront, [], `缺少 frontmatter description：${noFront.join("、")}`);
  ok(`模板体积与 frontmatter 合规（上限 ${MAX_BYTES}B）`);

  // 5) 主链路命令必须写明「不 clean 就停」
  const mustStop = ["dev.md", "cr.md"];
  for (const f of mustStop) {
    const body = fs.readFileSync(path.join(CMD_DIR, f), "utf8");
    assert.ok(/clean/.test(body), `${f} 应写明不 clean 即停止`);
  }
  ok("dev/cr 明确写了不 clean 就停");

  console.log(`\n全部通过：${passed} 项断言组（命令 ${files.length} 个）`);
})().catch(e => {
  console.error("\n✘ 契约测试失败：", e && e.message);
  process.exit(1);
});
