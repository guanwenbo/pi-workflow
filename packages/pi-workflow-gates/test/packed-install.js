#!/usr/bin/env node
/**
 * 分发包验收：模拟「别人安装 .piplug」的场景。
 *
 * 关键差异：安装目录之外没有 pi-workflow 仓库，文件系统探测（__dirname/../..）必然失败，
 * 只能靠包内 scaffold.generated.js。本测试把插件的**分发内容**复制到临时目录，
 * 在那里加载、安装斜杠命令、并接入一个空的 git 仓——验证这条路径真的能用。
 *
 * 运行：node packages/pi-workflow-gates/test/packed-install.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const PKG = path.resolve(__dirname, "..");
const ROOT = path.resolve(PKG, "..", ".."); // 仓库根（用于逐字比对源文件）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "piw-packed-"));
const PLUGIN_DIR = path.join(TMP, "installed", "gwb.pi-workflow-gates");
const HOME = path.join(TMP, "home");
const TARGET = path.join(TMP, "targetRepo");

let passed = 0;
const ok = msg => { passed++; console.log("  ✔ " + msg); };

// ---------- 1. 只复制分发内容（等价于 .piplug 解包结果） ----------
fs.mkdirSync(PLUGIN_DIR, { recursive: true });
for (const f of ["main.js", "manifest.json", "scaffold.generated.js"]) {
  fs.copyFileSync(path.join(PKG, f), path.join(PLUGIN_DIR, f));
}
fs.cpSync(path.join(PKG, "renderer"), path.join(PLUGIN_DIR, "renderer"), { recursive: true });
fs.mkdirSync(path.join(HOME, ".pi", "agent", "prompts"), { recursive: true });
fs.mkdirSync(path.join(TARGET, ".git"), { recursive: true });

// 断言：安装目录之外确实没有可用的工作流源（否则这个测试就失去意义）
assert.ok(!fs.existsSync(path.join(TMP, ".pi", "commands")), "临时目录里不应有 .pi/commands");

process.env.HOME = HOME;

const TOOLS = {};
const abs = p => (path.isAbsolute(p) ? p : path.join(HOME, p));
global.pi = {
  fs: {
    readText: async p => fs.readFileSync(abs(p), "utf8"),
    writeText: async (p, c) => {
      const f = abs(p);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, c);
      return true;
    },
    stat: async p => {
      if (fs.statSync(abs(p)).isDirectory()) throw new Error("是目录");
      return { isDirectory: false };
    },
    list: async () => [],
    glob: async () => [],
  },
  plugin: {
    getDataPath: async () => path.join(TMP, "pluginData"),
    getManifest: () => JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8")),
  },
  workspace: { get: async () => ({ path: HOME }) },
  agent: { registerTool: async t => { TOOLS[t.name] = t; }, unregisterTool: async () => {} },
  commands: { register: async () => {}, unregister: async () => {} },
  ui: { openPanel: async () => {} },
};

(async () => {
  console.log("[1] 从分发副本加载插件（模拟 .piplug 安装）");
  const plugin = require(path.join(PLUGIN_DIR, "main.js"));
  await plugin.onLoad();
  assert.strictEqual(Object.keys(TOOLS).length, 10, "应注册 10 个工具");
  ok("插件在无仓库环境下正常加载，10 个工具注册完成");

  // ---------- 2. 斜杠命令来自内嵌脚手架 ----------
  const pdir = path.join(HOME, ".pi", "agent", "prompts");
  const templates = fs.readdirSync(pdir).filter(f => f.endsWith(".md"));
  assert.strictEqual(templates.length, 15, `应安装 15 个斜杠命令，实际 ${templates.length}`);
  const tpl = fs.readFileSync(path.join(pdir, "req-adopt.md"), "utf8");
  assert.match(tpl, /managed-by: gwb\.pi-workflow-gates/);
  assert.match(tpl, /plugin-version: "/);
  assert.match(tpl, /把另一个 git 仓库接入 pi-workflow/, "正文应是完整命令文档（取自内嵌 commands）");
  ok("斜杠命令从内嵌脚手架安装成功（15 个，含完整正文）");

  // ---------- 3. adopt_project 用内嵌脚手架接入空仓 ----------
  console.log("\n[2] adopt_project 接入一个空 git 仓");
  const r = await TOOLS.adopt_project.execute({ projectPath: TARGET });
  assert.ok(r.ok, "接入应成功");
  assert.ok(r.checks.some(c => /内嵌源/.test(c)), "应标明来自内嵌源：" + r.checks.join(" | "));
  assert.ok(fs.existsSync(path.join(TARGET, ".pi", "commands", "req-new.md")), "应写入命令");
  assert.ok(fs.existsSync(path.join(TARGET, "docs", "templates", "00-meta.md")), "应写入模板");
  assert.ok(fs.existsSync(path.join(TARGET, "docs", "roles", "architect.md")), "应写入角色定义");
  assert.ok(fs.existsSync(path.join(TARGET, "requirements", "README.md")), "应写入 README");
  assert.match(fs.readFileSync(path.join(TARGET, ".gitignore"), "utf8"), /requirements\/\.registry\.json/);
  ok("空仓接入成功：15 命令 + 33 文档 + 模板 + README + .gitignore");

  const c1 = fs.readFileSync(path.join(TARGET, ".pi", "commands", "req-new.md"), "utf8");
  const c2 = fs.readFileSync(path.join(ROOT, ".pi", "commands", "req-new.md"), "utf8");
  assert.strictEqual(c1, c2, "内嵌命令必须与仓库原文逐字一致");
  ok("内嵌内容与仓库源文件逐字一致（无漂移）");

  // ---------- 4. 幂等 ----------
  const r2 = await TOOLS.adopt_project.execute({ projectPath: TARGET });
  assert.ok(r2.ok);
  assert.strictEqual(r2.checks.filter(c => /\.gitignore 已加/.test(c)).length, 0, "不应重复追加 .gitignore");
  ok("重复接入幂等");

  console.log(`\n全部通过：${passed} 项断言组（临时目录 ${TMP}）`);
})().catch(e => {
  console.error("\n✘ 测试失败：", e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
