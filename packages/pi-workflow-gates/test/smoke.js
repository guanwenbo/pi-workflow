/**
 * 冒烟测试：adopt_project + req_derive 的端到端行为（不依赖 PI-Desktop 宿主）。
 *
 * 用临时目录造两个「仓」：
 *   parentRepo  父需求所在仓（当前工作区）
 *   childRepo   目标仓（跨项目承接方）
 * 并按真实流程跑：adopt 两边 → 父需求建档 → derive → 目标仓接力建档 → 重跑验幂等。
 *
 * 运行：node packages/pi-workflow-gates/test/smoke.js
 * 只写系统临时目录，不碰仓库文件。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "piw-gates-"));
const PARENT = path.join(TMP, "parentRepo");
const CHILD = path.join(TMP, "childRepo");
const DATA = path.join(TMP, "pluginData");

let WS = PARENT;
const abs = p => (path.isAbsolute(p) ? p : path.join(WS, p));
// HOME 指向临时目录：插件的用户级斜杠命令会写到 ~/.pi/agent/prompts，测试必须隔离，不能碰真实 home
const HOME = path.join(TMP, "home");
fs.mkdirSync(path.join(HOME, ".pi", "agent", "prompts"), { recursive: true });
process.env.HOME = HOME;
// 宿主 pi 的最小替身：pi.fs 以当前工作区为根（与真实网关语义一致）
const TOOLS = {};
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
      const s = fs.statSync(abs(p));
      if (s.isDirectory()) throw new Error("是目录");
      return { size: s.size, isDirectory: false, name: path.basename(p), path: p };
    },
    list: async p => {
      const dir = abs(p);
      return fs.readdirSync(dir, { withFileTypes: true }).map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: String(p).replace(/\/$/, "") + "/" + e.name,
      }));
    },
    glob: async () => [],
  },
  plugin: {
    getDataPath: async () => DATA,
    // 与宿主一致：模板里记录的插件版本来自 manifest
    getSettings: async () => ({ autoUpdateCheck: false }), // 测试不打真实更新接口
    getManifest: () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")),
  },
  workspace: { get: async () => ({ path: WS }) },
  agent: {
    registerTool: async t => { TOOLS[t.name] = t; },
    unregisterTool: async () => {},
  },
  commands: { register: async () => {}, unregister: async () => {} },
  ui: { openPanel: async () => {} },
};

const call = async (name, args) => {
  const t = TOOLS[name];
  assert.ok(t, `工具未注册：${name}`);
  return t.execute(args);
};

let passed = 0;
const ok = msg => { passed++; console.log("  ✔ " + msg); };
(async () => {
  for (const d of [PARENT, CHILD]) {
    fs.mkdirSync(path.join(d, ".git"), { recursive: true }); // adopt 只校验 .git 存在
  }
  fs.mkdirSync(DATA, { recursive: true });

  // 用户自己已有的同名模板：插件必须绕开，不能抢占命令名
  const userOwned = path.join(HOME, ".pi", "agent", "prompts", "req-new.md");
  const userOwnedBody = "---\ndescription: my own req-new\n---\nmy content\n";
  fs.writeFileSync(userOwned, userOwnedBody);

  const plugin = require("../main.js");
  await plugin.onLoad();
  assert.strictEqual(Object.keys(TOOLS).length, 11, "应注册 11 个工具");
  ok("插件加载：11 个工具全部注册");


  // 斜杠命令：插件加载即全局安装（用户级目录），不依赖任何仓库内文件
  const gdir = path.join(HOME, ".pi", "agent", "prompts");
  const isManaged = f => fs.readFileSync(path.join(gdir, f), "utf8").includes("managed-by: gwb.pi-workflow-gates");
  const managed = fs.readdirSync(gdir).filter(f => f.endsWith(".md") && isManaged(f));
  assert.strictEqual(managed.length, 14, "15 个命令中，除用户占用的 req-new 外应装 14 个");
  assert.strictEqual(fs.readFileSync(userOwned, "utf8"), userOwnedBody, "不得覆盖用户自己的同名模板");
  const tpl = fs.readFileSync(path.join(gdir, "req-derive.md"), "utf8");
  assert.match(tpl, /^---\ndescription: "/, "模板必须有 frontmatter description");
  assert.match(tpl, /argument-hint: "/, "模板应带参数提示");
  assert.match(tpl, /plugin-version: "\d+\.\d+\.\d+"/, "模板应记录插件版本");
  assert.match(tpl, /跨项目承接/, "正文应是自包含的命令文档");
  assert.match(tpl, /\$\{@:-/, "正文应带参数占位");
  ok("插件加载即全局安装斜杠命令：14 个新建、用户同名文件不动");

  const mtimeBefore = managed.map(f => fs.statSync(path.join(gdir, f)).mtimeMs);
  await plugin.onLoad();
  const mtimeAfter = managed.map(f => fs.statSync(path.join(gdir, f)).mtimeMs);
  assert.deepStrictEqual(mtimeAfter, mtimeBefore, "内容未变的模板不应重写");
  ok("重复加载幂等：内容未变的模板不重写");
  // ---------- 1. 接入两个仓 ----------
  console.log("\n[1] adopt_project");
  const a1 = await call("adopt_project", { projectPath: CHILD });
  assert.ok(a1.ok);
  assert.ok(fs.existsSync(path.join(CHILD, ".pi", "commands", "req-new.md")), "应同步命令");
  assert.ok(!fs.existsSync(path.join(CHILD, ".pi", "prompts")), "项目级 prompts 已取消：命令由插件全局安装");
  assert.ok(fs.existsSync(path.join(CHILD, "docs", "templates", "00-meta.md")), "应同步模板");
  assert.ok(fs.existsSync(path.join(CHILD, "requirements", "README.md")), "应放 README");
  assert.match(fs.readFileSync(path.join(CHILD, ".gitignore"), "utf8"), /requirements\/\.registry\.json/);
  ok("目标仓接入：commands + docs + README + .gitignore 镜像忽略");

  const a2 = await call("adopt_project", { projectPath: CHILD }); // 幂等重跑
  assert.ok(a2.ok);
  assert.ok(a2.checks.some(c => /已含镜像忽略/.test(c)), "重跑不应重复追加 .gitignore");
  ok("adopt 幂等：重跑不重复追加 .gitignore");

  await call("adopt_project", { projectPath: PARENT }); // 父仓也需模板才能建档

  // ---------- 2. 父需求建档 ----------
  console.log("\n[2] 父需求建档");
  const parent = await call("req_init", { title: "首页图标修复", slug: "home-icon-fix" });
  const parentId = parent.reqId;
  ok(`父需求建档：${parentId}`);

  // ---------- 3. 派生到目标仓 ----------
  console.log("\n[3] req_derive");
  const d1 = await call("req_derive", {
    reqId: parentId,
    targetProject: CHILD,
    title: "营销侧图标素材接口",
    slug: "marketing-icon-api",
    note: "提供图标素材查询接口，父需求只消费",
    questions: ["接口 QPS 上限是多少", "素材缓存多久"],
  });
  assert.ok(d1.ok);
  assert.match(d1.derivedReqId, /^REQ-\d{8}-marketing-icon-api$/);
  assert.strictEqual(d1.created, true);
  assert.strictEqual(d1.alreadyAdopted, false);
  assert.deepStrictEqual(d1.dependsOn, [d1.derivedReqId]);
  ok(`派生编号：${d1.derivedReqId}`);

  const inbox = path.join(CHILD, "requirements", ".inbox", `${d1.derivedReqId}.md`);
  assert.ok(fs.existsSync(inbox), "目标仓应有 inbox 简报");
  const brief = fs.readFileSync(inbox, "utf8");
  assert.match(brief, /跨项目承接简报/);
  assert.match(brief, new RegExp(parentId));
  assert.match(brief, /marketing-icon-api/);
  assert.match(brief, /接口 QPS 上限是多少/);
  ok("简报投放到目标仓 requirements/.inbox/（含依赖方向、slug、待答问题）");

  const localBrief = path.join(PARENT, "requirements", parentId, "derive", `${d1.derivedReqId}.md`);
  assert.ok(fs.existsSync(localBrief), "本仓应留档简报");
  ok("本仓留档 requirements/<父>/derive/<子>.md");

  const parentMeta = fs.readFileSync(path.join(PARENT, "requirements", parentId, "00-meta.md"), "utf8");
  assert.match(parentMeta, new RegExp(`dependsOn: \\[${d1.derivedReqId}\\]`), "父需求 frontmatter 应挂依赖");
  ok("依赖双写：父需求 frontmatter dependsOn 已挂子需求");

  const intake = fs.readFileSync(path.join(PARENT, "requirements", parentId, "01-intake.md"), "utf8");
  assert.match(intake, /## 跨项目承接记录/);
  assert.match(intake, new RegExp(`\\| ${d1.derivedReqId} \\| childRepo \\| 待目标仓 /req-new \\|`));
  ok("回填 01-intake「跨项目承接记录」：状态=待目标仓 /req-new");

  assert.ok(d1.warnings.length >= 1, "未发布依赖应告警");
  ok("依赖告警：只告警不阻塞（warnings 非空）");

  const reg = JSON.parse(fs.readFileSync(path.join(DATA, "registry.json"), "utf8"));
  assert.strictEqual(reg.requirements[d1.derivedReqId].derivedFrom, parentId);
  assert.strictEqual(reg.requirements[d1.derivedReqId].project, "childRepo");
  ok("注册中心登记派生子需求（derivedFrom 幂等键）");

  // ---------- 4. 幂等重跑 ----------
  console.log("\n[4] 幂等");
  const d2 = await call("req_derive", { reqId: parentId, targetProject: "childRepo" });
  assert.strictEqual(d2.derivedReqId, d1.derivedReqId, "重跑应复用编号");
  assert.strictEqual(d2.created, false);
  assert.deepStrictEqual(d2.dependsOn, [d1.derivedReqId], "不应重复挂依赖");
  const intake2 = fs.readFileSync(path.join(PARENT, "requirements", parentId, "01-intake.md"), "utf8");
  assert.strictEqual(intake2.match(/## 跨项目承接记录/g).length, 1, "小节不应重复追加");
  ok("同一父+同一目标仓重跑：编号复用、依赖不重复、小节不重复（仓名片段也能解析）");

  // ---------- 5. 目标仓接力建档 ----------
  console.log("\n[5] 目标仓 agent 接力建档");
  WS = CHILD;
  const child = await call("req_init", { title: "营销侧图标素材接口", slug: "marketing-icon-api" });
  assert.strictEqual(child.reqId, d1.derivedReqId, "目标仓建档编号应与派生编号一致");
  ok(`目标仓建档：${child.reqId}`);

  WS = PARENT;
  const d3 = await call("req_derive", { reqId: parentId, targetProject: CHILD });
  assert.strictEqual(d3.alreadyAdopted, true, "应识别目标仓已建档");
  const intake3 = fs.readFileSync(path.join(PARENT, "requirements", parentId, "01-intake.md"), "utf8");
  assert.match(intake3, /\| 已建档 \|/, "建档后状态应刷成已建档");
  const reg3 = JSON.parse(fs.readFileSync(path.join(DATA, "registry.json"), "utf8"));
  assert.strictEqual(reg3.requirements[child.reqId].derivedFrom, parentId, "目标仓建档不应丢派生标记");
  ok("建档后重跑：状态翻成「已建档」，且 req_init 未冲掉 derivedFrom");

  // ---------- 6. 边界 ----------
  console.log("\n[6] 边界校验");
  await assert.rejects(() => call("req_derive", { reqId: parentId, targetProject: PARENT }), /同仓拆分/);
  ok("目标仓 = 当前仓：拒绝并提示用 /breakdown");

  const plain = path.join(TMP, "plainRepo");
  fs.mkdirSync(path.join(plain, ".git"), { recursive: true });
  await assert.rejects(() => call("req_derive", { reqId: parentId, targetProject: plain }), /尚未接入 pi-workflow/);
  ok("目标仓未接入：拒绝并给出 /req-adopt 指引");

  await assert.rejects(() => call("req_derive", { reqId: "REQ-20000101-nope", targetProject: CHILD }), /需求档案不存在/);
  ok("父需求不存在：拒绝");

  await assert.rejects(
    () => call("req_derive", { reqId: parentId, targetProject: "no-such-repo" }),
    /找不到目标仓/
  );
  ok("目标仓名无法解析：拒绝并提示用绝对路径");

  console.log(`\n全部通过：${passed} 项断言组，临时目录 ${TMP}`);
})().catch(err => {
  console.error("\n✘ 测试失败：", err && err.message);
  console.error(err && err.stack);
  process.exit(1);
});
