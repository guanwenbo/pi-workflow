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
  assert.strictEqual(Object.keys(TOOLS).length, 22, "应注册 22 个工具");
  ok("插件加载：22 个工具全部注册");


  // 斜杠命令：插件加载即全局安装（用户级目录），不依赖任何仓库内文件
  const gdir = path.join(HOME, ".pi", "agent", "prompts");
  const isManaged = f => fs.readFileSync(path.join(gdir, f), "utf8").includes("managed-by: gwb.pi-workflow-gates");
  const managed = fs.readdirSync(gdir).filter(f => f.endsWith(".md") && isManaged(f));
  // 命令总数跟着脚手架走，新增命令不必改测试
  const scaffoldFiles = require("../scaffold.generated.js").files || [];
  const cmdCount = scaffoldFiles.filter(f => f.startsWith(".pi/commands/") && f.endsWith(".md")).length;
  assert.strictEqual(managed.length, cmdCount - 1, `${cmdCount} 个命令中，除用户占用的 req-new 外应装 ${cmdCount - 1} 个`);
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

  // ---------- 7. 未接入仓建档：模板回退到插件内嵌脚手架 ----------
  // 真实场景：在一个 Java 工程里直接跑 /req-new，该仓还没有 docs/templates。
  console.log("\n[7] 未接入仓建档（内嵌模板兜底）");
  const jvmRepo = path.join(TMP, "jvmRepo");
  fs.mkdirSync(path.join(jvmRepo, ".git"), { recursive: true });
  const prevWS = WS;
  WS = jvmRepo;
  const bare = await call("req_init", { title: "七鲜双端会员", slug: "qixian-dual-end-member" });
  assert.strictEqual(bare.templateSource, "embedded", "无 docs/templates 时应回退内嵌脚手架");
  assert.strictEqual(bare.adopted, false, "未接入仓应标记 adopted=false");
  assert.ok(bare.warnings.some(w => /尚未接入 pi-workflow/.test(w)), "应提示先 /req-adopt");
  assert.match(
    fs.readFileSync(path.join(jvmRepo, bare.dir, "00-meta.md"), "utf8"),
    /REQ-\d{8}-qixian-dual-end-member/
  );
  WS = prevWS;
  ok("未接入仓建档成功：模板取自内嵌脚手架，并提示补接入");

  // ---------- 8. 体量分级 + 新工具 ----------
  console.log("\n[8] 体量分级 / design_lint / trace_matrix / verify");
  WS = PARENT;
  const bug = await call("req_init", { title: "结账金额显示错误", slug: "checkout-amount-bug", tier: "T0" });
  assert.strictEqual(bug.tier, "T0");
  assert.match(fs.readFileSync(path.join(PARENT, bug.dir, "00-meta.md"), "utf8"), /^tier: T0$/m);
  ok("req_init 支持 tier，写入 00-meta frontmatter");

  const noDesign = await call("state_check", { reqId: bug.reqId, command: "design" });
  assert.strictEqual(noDesign.ok, false);
  assert.match(noDesign.hint, /T0/);
  ok("T0 走 /design 被拒：提示该级别不走此命令");

  const direct = await call("state_transition", { reqId: bug.reqId, to: "developing" });
  assert.strictEqual(direct.ok, true, "T0 允许 draft → developing（跳过设计与拆解）");
  ok("T0 分级流转：draft → developing 直接放行");

  const badFlow = await call("state_transition", { reqId: bug.reqId, to: "clarifying" });
  assert.strictEqual(badFlow.ok, false, "T0 不应允许走 clarifying");
  ok("T0 拒绝走主干状态（clarifying）");

  // 产出缺失拦截：T0 进 archived 需要 SUMMARY.md（已由 req_init 建）
  const logFile = path.join(PARENT, bug.dir, "log");
  const today = fs.readdirSync(logFile);
  assert.ok(today.length >= 1 && /\.md$/.test(today[0]), "状态流转应自动写过程流水");
  ok(`过程流水自动追加：log/${today[0]}`);

  // design_lint：空设计 + 缺章节 → warn 模式 ok 但报 blocker
  const lint = await call("design_lint", { reqId: parentId, mode: "warn" });
  assert.strictEqual(lint.mode, "warn");
  assert.ok(Array.isArray(lint.findings));
  ok(`design_lint 返回结构化问题（${lint.findings.length} 条，模式 warn）`);

  // trace_matrix：无 AC 时 gaps 为空但结构完整
  const matrix = await call("trace_matrix", { reqId: parentId });
  assert.ok(matrix.gaps && Array.isArray(matrix.gaps.acNoTask));
  ok("trace_matrix 返回矩阵与缺口结构");

  // verify_record + log_append
  await call("verify_record", { reqId: parentId, task: "T-01", command: "mvn test", exitCode: 0 });
  const ev = JSON.parse(fs.readFileSync(path.join(PARENT, "requirements", parentId, "evidence.json"), "utf8"));
  assert.strictEqual(ev[0].pass, true);
  ok("verify_record 落 evidence.json（pass=true）");

  await call("log_append", { reqId: parentId, role: "架构师CR", text: "第1轮评审不通过：缺幂等设计" });
  const logs = fs.readdirSync(path.join(PARENT, "requirements", parentId, "log"));
  const body = fs.readFileSync(path.join(PARENT, "requirements", parentId, "log", logs[0]), "utf8");
  assert.match(body, /架构师CR/);
  ok("log_append 写入过程流水（含角色）");

  // analyze / converge 可执行且返回缺口
  const an = await call("analyze", { reqId: parentId, mode: "warn" });
  assert.ok(typeof an.clean === "boolean" && an.gaps);
  ok(`analyze 返回缺口报告（clean=${an.clean}）`);

  const cv = await call("converge", { reqId: parentId, append: false });
  assert.ok(typeof cv.clean === "boolean");
  ok(`converge 可只读运行（clean=${cv.clean}）`);

  // ---------- 9. 派发纪律 / 活规格 / 契约问答回流 ----------
  console.log("\n[9] dispatch_record / spec_merge / answer_return");
  fs.mkdirSync(path.join(PARENT, "docs"), { recursive: true });
  fs.writeFileSync(path.join(PARENT, "docs", "role-bindings.json"),
    JSON.stringify({ "架构师CR": "model-A" }));
  const wrong = await call("dispatch_record", { reqId: parentId, role: "架构师CR", task: "方案评审", model: "model-B" });
  assert.strictEqual(wrong.ok, false);
  assert.match(wrong.hint, /不得更换模型/);
  const right = await call("dispatch_record", { reqId: parentId, role: "架构师CR", task: "方案评审", model: "model-A" });
  assert.strictEqual(right.ok, true);
  const prog = await call("dispatch_record", { reqId: parentId, role: "开发工程师", task: "T-01 进行中 60%", kind: "progress" });
  assert.strictEqual(prog.ok, true);
  ok("派发纪律：擅自换模型被拒，绑定一致放行，进度可回写");

  fs.writeFileSync(path.join(PARENT, "requirements", parentId, "spec-delta.md"),
    "## 影响能力\n\ncoupon-issue\n\n### ADDED R-01 发券幂等\n\n- WHEN 同一 requestId 重复请求\n- THEN 只发一张券\n");
  const sm1 = await call("spec_merge", { reqId: parentId, capability: "coupon-issue" });
  assert.strictEqual(sm1.added, 1);
  assert.match(fs.readFileSync(path.join(PARENT, "specs", "coupon-issue", "spec.md"), "utf8"), /R-01 发券幂等/);
  const sm2 = await call("spec_merge", { reqId: parentId, capability: "coupon-issue" });
  assert.strictEqual(sm2.modified, 1, "重复合并应按 ID 替换而不是重复追加");
  ok("活规格：增量合并进 specs/，重复合并幂等");

  if (d1 && d1.derivedReqId) {
    WS = CHILD;
    const ans = await call("answer_return", {
      reqId: d1.derivedReqId,
      answers: [{ question: "接口 QPS 上限是多少", answer: "峰值 200 QPS" }],
    });
    assert.strictEqual(ans.parent, parentId);
    assert.ok(fs.existsSync(ans.file), "父仓应有问答回流文件");
    assert.match(fs.readFileSync(ans.file, "utf8"), /峰值 200 QPS/);
    WS = PARENT;
    ok("契约问答回流：目标仓答复自动写回父仓 derive/");
  }

  // ---------- 10. 打回原因统计 ----------
  console.log("\n[10] rework_top");
  await call("metrics_record", { reqId: parentId, kind: "human_reject", note: "自造词看不懂", reason: "自造词" });
  await call("metrics_record", { reqId: parentId, kind: "human_reject", note: "又一处自造词", reason: "自造词" });
  const rt = await call("rework_top", {});
  assert.strictEqual(rt.ok, true);
  assert.strictEqual(rt.reasons[0].reason, "自造词");
  assert.ok(rt.reasons[0].count >= 2, `应聚合到至少 2 次，实际 ${rt.reasons[0].count}`);
  ok(`打回原因聚合：TOP1「${rt.reasons[0].reason}」${rt.reasons[0].count} 次`);

  // ---------- 11. 幂等与并发 ----------
  console.log("\n[11] 幂等 / 乐观并发 / 重试队列");
  await call("verify_record", { reqId: parentId, task: "T-02", command: "mvn test", exitCode: 0 });
  const dup = await call("verify_record", { reqId: parentId, task: "T-02", command: "mvn test", exitCode: 0 });
  assert.strictEqual(dup.already, true, "同任务同命令同结果应幂等");
  const ev2 = JSON.parse(fs.readFileSync(path.join(PARENT, "requirements", parentId, "evidence.json"), "utf8"));
  assert.strictEqual(ev2.filter(e => e.task === "T-02").length, 1, "证据不得重复堆叠");
  ok("verify_record 幂等：重复上报只留一条");

  const l1 = await call("log_append", { reqId: parentId, role: "开发", text: "T-02 完成" });
  const l2 = await call("log_append", { reqId: parentId, role: "开发", text: "T-02 完成" });
  assert.strictEqual(l2.already, true, "当天同角色同内容应幂等");
  ok("log_append 幂等：不会把同一句话写两遍");

  // 乐观并发：用错误的 baseRev 写回必须被拒
  const metaNow = fs.readFileSync(path.join(PARENT, "requirements", parentId, "00-meta.md"), "utf8");
  const realRev = require("../main.js").__test.fmRev(metaNow);
  await assert.rejects(
    () => require("../main.js").__test.writeMetaChecked(parentId, metaNow, realRev + 99),
    /并发冲突/
  );
  await require("../main.js").__test.writeMetaChecked(parentId, metaNow, realRev); // 正确 rev 放行
  const bumped = fs.readFileSync(path.join(PARENT, "requirements", parentId, "00-meta.md"), "utf8");
  assert.strictEqual(plugin.__test.fmRev(bumped), realRev + 1);
  ok("乐观并发：rev 不符拒写，相符则 rev+1");

  const pe = await call("pending_effects", {});
  assert.strictEqual(typeof pe.pending, "number");
  ok(`重试队列可查询（当前待重试 ${pe.pending} 项）`);

  console.log(`\n全部通过：${passed} 项断言组，临时目录 ${TMP}`);
})().catch(err => {
  console.error("\n✘ 测试失败：", err && err.message);
  console.error(err && err.stack);
  process.exit(1);
});
