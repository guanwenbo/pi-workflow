#!/usr/bin/env node
/**
 * 更新检查测试：版本比对、缓存、下载提示、离线降级。
 *
 * 用 file:// 作为版本清单来源（生产是 raw.githubusercontent 上的 latest.json），
 * 这样测试不依赖网络、不受 api.github.com 403 影响。
 *
 * 运行：node packages/pi-workflow-gates/test/update-check.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const PKG = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "piw-update-"));
const HOME = path.join(TMP, "home");
const DATA = path.join(TMP, "pluginData");
const LATEST = path.join(TMP, "latest.json");

fs.mkdirSync(path.join(HOME, ".pi", "agent", "prompts"), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
process.env.HOME = HOME;
process.env.PI_WORKFLOW_UPDATE_URL = `file://${LATEST}`;

const writeLatest = obj => fs.writeFileSync(LATEST, JSON.stringify(obj));
writeLatest({ version: "0.9.9", tag: "v0.9.9", downloadUrl: `file://${TMP}/fake.piplug`, notes: ["测试更新"] });
fs.writeFileSync(path.join(TMP, "fake.piplug"), "fake-package-bytes");

const TOOLS = {};
let toasts = [];
global.pi = {
  fs: {
    readText: async p => fs.readFileSync(path.isAbsolute(p) ? p : path.join(HOME, p), "utf8"),
    writeText: async () => true,
    stat: async p => { if (fs.statSync(path.isAbsolute(p) ? p : path.join(HOME, p)).isDirectory()) throw new Error("dir"); return { isDirectory: false }; },
    list: async () => [],
    glob: async () => [],
  },
  plugin: {
    getDataPath: async () => DATA,
    getManifest: () => JSON.parse(fs.readFileSync(path.join(PKG, "manifest.json"), "utf8")),
    getSettings: async () => ({}),
  },
  workspace: { get: async () => ({ path: HOME }) },
  agent: { registerTool: async t => { TOOLS[t.name] = t; }, unregisterTool: async () => {} },
  commands: { register: async () => {}, unregister: async () => {} },
  ui: { openPanel: async () => {}, showToast: async m => { toasts.push(m); } },
};

let passed = 0;
const ok = msg => { passed++; console.log("  ✔ " + msg); };

(async () => {
  const plugin = require(path.join(PKG, "main.js"));
  await plugin.onLoad();
  assert.ok(TOOLS.check_update, "check_update 应注册");
  ok("插件加载含 check_update 工具（共 " + Object.keys(TOOLS).length + " 个）");

  // 加载时的静默检查已发现新版并提示过一次
  const state1 = JSON.parse(fs.readFileSync(path.join(DATA, "update-check.json"), "utf8"));
  assert.strictEqual(state1.latest, "0.9.9");
  assert.strictEqual(state1.notifiedFor, "0.9.9", "应记录已提示版本，避免每次启动重复打扰");
  ok("加载时静默检查：记录最新版并只提示一次（toast " + toasts.length + " 条）");

  // 缓存命中：24h 内不再联网
  const cached = await TOOLS.check_update.execute({});
  assert.strictEqual(cached.cached, true, "24h 内应走缓存");
  assert.strictEqual(cached.latest, "0.9.9");
  ok("24 小时缓存命中，不重复联网");

  // force 重新检查 + 下载
  const forced = await TOOLS.check_update.execute({ force: true, download: true });
  assert.strictEqual(forced.upToDate, false);
  assert.ok(forced.downloadedTo && fs.existsSync(forced.downloadedTo), "应下载到本地");
  assert.match(forced.downloadedTo, /Downloads\/gwb\.pi-workflow-gates-0\.9\.9\.piplug$/);
  assert.match(forced.next, /Install package/);
  ok("force 检查 + 自动下载新版到 ~/Downloads，并给出安装指引");

  // 已是最新
  writeLatest({ version: "0.9.4", tag: "v0.9.4", downloadUrl: "" });
  const same = await TOOLS.check_update.execute({ force: true });
  assert.strictEqual(same.upToDate, true, "同版本应判定为最新");
  ok("同版本判定为已最新（不误报）");

  // 语义化比较：0.9.10 > 0.9.9（不能按字符串比）
  writeLatest({ version: "0.9.10" });
  const newer = await TOOLS.check_update.execute({ force: true });
  assert.strictEqual(newer.upToDate, false, "0.9.10 应大于 0.9.9 与本机 0.9.4");
  ok("版本按数字段比较（0.9.10 > 0.9.9），不是字符串比较");

  // 降级版本不应提议升级
  writeLatest({ version: "0.9.3" });
  const older = await TOOLS.check_update.execute({ force: true });
  assert.strictEqual(older.upToDate, true, "清单版本更旧时不应提示升级");
  ok("清单版本旧于本机时不提示升级");

  // 离线/清单不可达：不抛错
  const offline = await TOOLS.check_update.execute({ force: true, source: `file://${TMP}/does-not-exist.json` });
  assert.strictEqual(offline.ok, false);
  assert.match(offline.error, /检查更新失败/);
  ok("清单不可达时返回 ok=false 且不抛错（离线可用）");

  // 关闭自动检查
  global.pi.plugin.getSettings = async () => ({ autoUpdateCheck: false });
  const skip = await require(path.join(PKG, "main.js")).onLoad(); // 不应抛错
  assert.ok(skip === undefined);
  ok("autoUpdateCheck=false 时加载不报错（静默跳过）");

  console.log(`\n全部通过：${passed} 项断言组（临时目录 ${TMP}）`);
})().catch(e => {
  console.error("\n✘ 测试失败：", e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
