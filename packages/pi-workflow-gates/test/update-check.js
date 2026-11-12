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
// 自更新目标目录：测试不能真的覆盖仓库里的插件目录
const SELF_TARGET = path.join(TMP, "selfUpdateTarget");
process.env.PI_WORKFLOW_SELF_UPDATE_DIR = SELF_TARGET;

/** 造一个 store（不压缩）方式的 ZIP，模拟 PluginPack 产出的 .piplug */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);   // version needed
    local.writeUInt16LE(0, 6);    // flags
    local.writeUInt16LE(0, 8);    // method = store
    local.writeUInt32LE(0, 14);   // crc（解析端不校验）
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);      // method
    cd.writeUInt32LE(0, 16);      // crc
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    chunks.push(local, nameBuf, data);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const pkgManifest = (version, id) => JSON.stringify({ schemaVersion: 1, id, version, main: "main.js" });

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

  // ---------- 自更新：真包解压覆盖自身 ----------
  console.log("\n[自更新] 下载 .piplug → 解包 → 就地覆盖");

  const writePkg = (file, entries) => fs.writeFileSync(file, buildZip(entries));

  // 正常路径：装到 selfUpdateTarget（模拟 plugins/installed 布局）
  const goodPkg = path.join(TMP, "good.piplug");
  writePkg(goodPkg, {
    "manifest.json": pkgManifest("0.9.9", "gwb.pi-workflow-gates"),
    "main.js": "// new main\nmodule.exports = {};\n",
    "renderer/index.html": "<html>new panel</html>",
  });
  writeLatest({ version: "0.9.9", tag: "v0.9.9", downloadUrl: `file://${goodPkg}` });
  const applied = await TOOLS.check_update.execute({ force: true, apply: true });
  assert.strictEqual(applied.upToDate, false);
  assert.ok(applied.applied && applied.applied.ok, `应自动安装成功：${JSON.stringify(applied.applied)}`);
  assert.strictEqual(applied.pendingReload, true, "安装后应标记待重启生效");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(SELF_TARGET, "manifest.json"), "utf8")).version, "0.9.9");
  assert.match(fs.readFileSync(path.join(SELF_TARGET, "main.js"), "utf8"), /new main/);
  assert.match(fs.readFileSync(path.join(SELF_TARGET, "renderer", "index.html"), "utf8"), /new panel/);
  ok("自动更新：解包 .piplug 并覆盖安装目录（含子目录），落盘自检通过");

  // 幂等：同一版本不重复下载覆盖
  const again = await TOOLS.check_update.execute({ force: true, apply: true });
  assert.ok(again.applied && again.applied.alreadyApplied, "同版本应短路，不重复覆盖");
  ok("幂等：同一版本不重复下载/覆盖");

  // 拒装别的插件
  const wrongPkg = path.join(TMP, "wrong.piplug");
  writePkg(wrongPkg, { "manifest.json": pkgManifest("1.0.0", "someone.else"), "main.js": "x" });
  writeLatest({ version: "1.0.0", tag: "v1.0.0", downloadUrl: `file://${wrongPkg}` });
  const wrong = await TOOLS.check_update.execute({ force: true, apply: true });
  assert.strictEqual(wrong.applied.ok, false);
  assert.match(wrong.applied.error, /别的插件/);
  ok("身份校验：包 id 不是本插件时拒绝安装");

  // 版本必须与清单一致（防串版本）
  const stalePkg = path.join(TMP, "stale.piplug");
  writePkg(stalePkg, { "manifest.json": pkgManifest("1.0.1", "gwb.pi-workflow-gates"), "main.js": "x" });
  writeLatest({ version: "1.1.0", tag: "v1.1.0", downloadUrl: `file://${stalePkg}` });
  const stale = await TOOLS.check_update.execute({ force: true, apply: true });
  assert.strictEqual(stale.applied.ok, false);
  assert.match(stale.applied.error, /不一致/);
  ok("版本校验：包内版本与清单不一致时拒绝");

  // 路径穿越
  const evilPkg = path.join(TMP, "evil.piplug");
  writePkg(evilPkg, {
    "manifest.json": pkgManifest("1.2.0", "gwb.pi-workflow-gates"),
    "../evil.txt": "pwned",
  });
  writeLatest({ version: "1.2.0", tag: "v1.2.0", downloadUrl: `file://${evilPkg}` });
  const evil = await TOOLS.check_update.execute({ force: true, apply: true });
  assert.strictEqual(evil.applied.ok, false);
  assert.match(evil.applied.error, /非法路径/);
  assert.ok(!fs.existsSync(path.join(TMP, "evil.txt")), "不得写出目标目录之外");
  ok("安全：拒绝 .. 路径穿越，不写到目录外");

  // 关闭自动安装：autoUpdate=false 时只提示不动手
  writeLatest({ version: "1.3.0", tag: "v1.3.0", downloadUrl: "" });
  global.pi.plugin.getSettings = async () => ({ autoUpdate: false });
  const noAuto = await TOOLS.check_update.execute({ force: true, apply: true });
  assert.ok(!noAuto.applied || noAuto.applied.ok === false, "autoUpdate=false 时不得安装");
  ok("autoUpdate=false 时不做自动安装（仅提示）");

  console.log(`\n全部通过：${passed} 项断言组（临时目录 ${TMP}）`);
})().catch(e => {
  console.error("\n✘ 测试失败：", e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
