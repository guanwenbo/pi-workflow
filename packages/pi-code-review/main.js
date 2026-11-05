/**
 * PI-Code Review — pi-workflow 代码级评审判定层插件
 *
 * 平台硬约束（详见 pi-desktop 插件规范）：
 *  1. 宿主无进程执行 API → 本插件**不跑** mvn/sonar/checkstyle，执行由 Agent 的 Bash +
 *     scripts/review/run-l1.sh 完成，产物落在 reviews/R-NN/raw 后交给 cr_ingest 归一。
 *  2. `.git/` 一律不可读 → diff 由 Agent 用 git diff 落盘，路径经 diffPath 传入。
 * 因此本插件只做「归一 → 判定 → 账本」三件事，与 pi-workflow-gates 同范式。
 *
 * 写入范围见 manifest.fs：仅 requirements/**；不执行进程、不访问网络、不改源码、不删文件。
 */

// ---------- 常量 ----------

const LEVELS = ["blocker", "major", "minor"];
const RESOLVED_STATUS = ["已修复", "已验证", "驳回", "豁免"];

const EXPECTED_TOOLS = [
  "dependency_tree", "archunit", "checkstyle", "pmd", "spotbugs", "errorprone",
  "semgrep", "gitleaks", "enforcer", "dependency_analyze",
  "dependencycheck", "sonar",
];
// 工具 → R 项（ruleId 启发式见 mapRule）
const TOOL_R = {
  archunit: "R2", checkstyle: "R10", pmd: "R10", p3c: "R10",
  spotbugs: "R1", errorprone: "R1", semgrep: "R-SEC", gitleaks: "R-SEC",
  dependencycheck: "R0", enforcer: "R0", dependency_analyze: "R0", dependency_tree: "R0", sonar: "R10",
};

// 严重度映射（可被工作区 rules/severity.json 覆盖）
const DEFAULT_SEVERITY = {
  gitleaks: { _default: "blocker" },
  enforcer: { _default: "blocker" },
  archunit: { _default: "blocker" },
  errorprone: { _default: "blocker" },
  semgrep: { error: "blocker", warning: "major", note: "minor", info: "minor", _default: "major" },
  checkstyle: { _default: "minor" },
  pmd: { blocker: "major", critical: "major", major: "minor", minor: "minor", _default: "minor" },
  p3c: { blocker: "major", critical: "major", major: "minor", minor: "minor", _default: "minor" },
  spotbugs: { high: "blocker", medium: "major", low: "minor", _default: "minor" },
  dependencycheck: { critical: "blocker", severe: "blocker", high: "blocker", medium: "major", low: "minor", _default: "minor" },
  // jar 冲突：dependency:tree 是零配置可用手段，级别必须原样落地，不能被兜底表降级
  dependency_tree: { blocker: "blocker", major: "major", _default: "major" },
  dependency_analyze: { _default: "minor" },
  sonar: { blocker: "blocker", critical: "major", major: "minor", _default: "minor" },
};

// ---------- 通用工具 ----------

function pad2(n) { return String(n).padStart(2, "0"); }

function nowMinute() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function exists(p) {
  try { await pi.fs.stat(p); return true; } catch { return false; }
}

async function readText(p) { return pi.fs.readText(p); }

async function readJson(p, fallback) {
  try { return JSON.parse(await pi.fs.readText(p)); } catch { return fallback; }
}

async function writeJson(p, obj) {
  await pi.fs.writeText(p, JSON.stringify(obj, null, 2) + "\n");
}

async function listNames(dir) {
  try {
    const r = await pi.fs.list(dir);
    return (r || []).map(e => (typeof e === "string" ? e : (e.name || e.path || ""))).filter(Boolean);
  } catch { return []; }
}

/** 32 位 FNV-1a，输出 8 位十六进制；不依赖 node 内置模块 */
function fpOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

function decodeEnt(s) {
  return String(s || "")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attr(attrs, name) {
  const m = String(attrs || "").match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : "";
}

function stripUri(u) {
  let s = String(u || "").replace(/^file:\/\//, "").replace(/^\.\//, "");
  const i = s.indexOf("/workspace/");
  if (i >= 0) s = s.slice(i + "/workspace/".length);
  return s;
}

function pathKey(p) { return stripUri(p).replace(/\\/g, "/"); }

// ---------- 档案路径 ----------

function reqDir(reqId) { return `requirements/${reqId}`; }
function reviewsDir(reqId) { return `${reqDir(reqId)}/reviews`; }
function roundDir(reqId, n) { return `${reviewsDir(reqId)}/R-${pad2(n)}`; }
function planPath(reqId, n) { return `${roundDir(reqId, n)}/plan.json`; }
function issuesPath(reqId, n) { return `${roundDir(reqId, n)}/issues.json`; }
function statePath(reqId) { return `${reviewsDir(reqId)}/state.json`; }
function baselinePath(reqId) { return `${reviewsDir(reqId)}/baseline.json`; }
function baselineLogPath(reqId) { return `${reviewsDir(reqId)}/baseline-log.md`; }
function waiversPath(reqId) { return `${reviewsDir(reqId)}/waivers.md`; }
function reportPath(reqId) { return `${reqDir(reqId)}/06a-code-review.md`; }

// ---------- 00-meta 解析 ----------

function frontmatter(content) {
  const m = String(content || "").match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

function fmField(content, key) {
  const fm = frontmatter(content);
  const line = fm.split("\n").map(l => l.trim()).find(l => new RegExp("^" + key + "\\s*:").test(l));
  if (!line) return "";
  return line.split(":").slice(1).join(":").trim();
}

async function loadMeta(reqId) {
  const p = `${reqDir(reqId)}/00-meta.md`;
  if (!(await exists(p))) throw new Error(`需求档案不存在：${p}（请先执行 /req-new 建档）`);
  const content = await readText(p);
  // 不设默认值：未声明时留空，由 L2 端归属判定决定，避免"默认交易链路"被误读成已判定
  return { content, status: fmField(content, "status"), scene: fmField(content, "scene"), title: fmField(content, "title") };
}

async function maxRound(reqId) {
  const names = await listNames(reviewsDir(reqId));
  let max = 0;
  for (const n of names) {
    const m = /^R-(\d+)$/.exec(String(n).replace(/\/$/, ""));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

async function resolveRound(reqId, round) {
  if (round != null && round !== "") {
    const n = parseInt(round, 10);
    if (!Number.isFinite(n) || n < 1) throw new Error(`轮次非法：${round}`);
    return n;
  }
  const max = await maxRound(reqId);
  if (max < 1) throw new Error("尚未开轮（请先调用 cr_begin）");
  return max;
}

async function loadSeverity() {
  const override = await readJson("rules/severity.json", null);
  if (!override || typeof override !== "object") return DEFAULT_SEVERITY;
  const merged = {};
  for (const k of Object.keys(DEFAULT_SEVERITY)) merged[k] = { ...DEFAULT_SEVERITY[k] };
  for (const k of Object.keys(override)) {
    merged[k] = override[k] && typeof override[k] === "object" ? override[k] : { _default: override[k] };
  }
  return merged;
}

function levelOf(severity, tool, raw) {
  // 未知工具不得借用 p3c 的映射（会把 blocker 静默降级），一律按 major 兜底
  const map = severity[tool] || { _default: "major" };
  const key = String(raw || "").toLowerCase();
  if (map[key]) return map[key];
  if (map._default) return map._default;
  return "minor";
}

function mapRule(tool, rule) {
  const id = String(rule || "");
  if (tool === "pmd" || tool === "p3c" || tool === "checkstyle") {
    if (/unused|deadcode|emptyblock|unuseddeclared|UselessOverriding/i.test(id)) return "R6";
    return "R10";
  }
  if (tool === "spotbugs") {
    if (/^(URF_|UUF_|DLS_DEAD|UPM_)/.test(id)) return "R6";
    if (/SEC|SQL|XSS|XXE|PATH|HARD_CODE|PREDICTABLE/i.test(id)) return "R-SEC";
    return "R1";
  }
  if (tool === "archunit") {
    if (/subdomain|same.?layer|sibling|layer.?inter/i.test(id)) return "R3";
    return "R2";
  }
  if (tool === "sonar") {
    if (/vuln|security|hardcoded|sqli|xss|injection/i.test(id)) return "R-SEC";
    return "R10";
  }
  return TOOL_R[tool] || "R1";
}

// ---------- diff 解析 ----------

function parseDiff(diff) {
  const files = new Map();
  const stats = { files: 0, additions: 0, deletions: 0 };
  let cur = null;
  let newLine = 0;
  for (const raw of String(diff || "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      let p = raw.slice(4).trim().split("\t")[0];
      if (p === "/dev/null") { cur = null; continue; }
      if (p.startsWith("b/")) p = p.slice(2);
      cur = pathKey(p);
      if (!files.has(cur)) files.set(cur, new Set());
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { newLine = parseInt(h[1], 10); continue; }
    if (cur === null) continue;
    if (raw.startsWith("+")) { files.get(cur).add(newLine); stats.additions++; newLine++; }
    else if (raw.startsWith("-")) { stats.deletions++; }
    else if (raw.startsWith("\\")) { /* no newline marker */ }
    else { newLine++; }
  }
  stats.files = files.size;
  return { files, stats };
}

// ---------- 工具产物解析 ----------

function parseSarif(txt) {
  const out = [];
  let o;
  try { o = JSON.parse(txt); } catch { return out; }
  for (const run of o.runs || []) {
    const dn = String((run.tool && run.tool.driver && run.tool.driver.name) || "semgrep").toLowerCase();
    const tool = dn.includes("gitleaks") ? "gitleaks" : dn.includes("spotbugs") ? "spotbugs" : "semgrep";
    for (const r of run.results || []) {
      const loc = (r.locations && r.locations[0] && r.locations[0].physicalLocation) || {};
      out.push({
        tool,
        rule: r.ruleId || (r.rule && r.rule.id) || "",
        level: r.level || "warning",
        file: pathKey(loc.artifactLocation && loc.artifactLocation.uri),
        line: (loc.region && loc.region.startLine) || 0,
        message: (r.message && r.message.text) || "",
      });
    }
  }
  return out;
}

function parseCheckstyle(xml) {
  const out = [];
  const parts = String(xml).split(/<file name="/).slice(1);
  for (const p of parts) {
    const fn = pathKey(p.slice(0, p.indexOf('"')));
    const re = /<error\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(p))) {
      const a = m[1];
      const src = attr(a, "source");
      out.push({
        tool: "checkstyle",
        rule: src.split(".").pop() || src,
        level: attr(a, "severity") || "warning",
        file: fn,
        line: parseInt(attr(a, "line"), 10) || 0,
        message: decodeEnt(attr(a, "message")),
      });
    }
  }
  return out;
}

function parsePmd(xml) {
  const out = [];
  const isP3c = /p3c|ali-?p3c/i.test(String(xml).slice(0, 4000));
  const parts = String(xml).split(/<file name="/).slice(1);
  for (const p of parts) {
    const fn = pathKey(p.slice(0, p.indexOf('"')));
    const re = /<violation\b([^>]*)>([\s\S]*?)<\/violation>/g;
    let m;
    while ((m = re.exec(p))) {
      const a = m[1];
      const pr = parseInt(attr(a, "priority"), 10) || 3;
      const lvl = pr <= 1 ? "blocker" : pr === 2 ? "critical" : pr === 3 ? "major" : "minor";
      out.push({
        tool: isP3c ? "p3c" : "pmd",
        rule: attr(a, "rule") || attr(a, "ruleset").split("/").pop(),
        level: lvl,
        file: fn,
        line: parseInt(attr(a, "beginline"), 10) || 0,
        message: decodeEnt(norm(m[2])),
      });
    }
  }
  return out;
}

function parseSpotbugs(xml) {
  const out = [];
  const chunks = String(xml).split(/<BugInstance\b/).slice(1);
  for (const c of chunks) {
    const type = attr(c, "type");
    const pr = parseInt(attr(c, "priority"), 10) || 3;
    const sl = c.match(/<SourceLine\b([^>]*?)\/?>/);
    const msg = c.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/);
    out.push({
      tool: "spotbugs",
      rule: type,
      level: pr === 1 ? "high" : pr === 2 ? "medium" : "low",
      file: sl ? pathKey(attr(sl[1], "sourcepath")) : "",
      line: sl ? parseInt(attr(sl[1], "start"), 10) || 0 : 0,
      message: msg ? decodeEnt(norm(msg[1])) : type,
    });
  }
  return out;
}

function parseSonar(txt) {
  const out = [];
  let o;
  try { o = JSON.parse(txt); } catch { return out; }
  const gate = o.qualityGate || o.quality_gate || {};
  const status = String(gate.status || o.status || "").toUpperCase();
  if (status === "ERROR" || status === "FAILED") {
    out.push({ tool: "sonar", rule: "quality-gate", level: "blocker", file: "", line: 0, message: "Sonar 质量门禁未通过（new code）" });
  }
  for (const i of o.issues || []) {
    out.push({
      tool: "sonar",
      rule: i.rule || "",
      level: i.severity || "major",
      file: pathKey(i.component || i.file || ""),
      line: i.line || 0,
      message: norm(i.message),
    });
  }
  return out;
}

function parseDepTree(txt) {
  // maven-dependency-plugin 是 maven 内置插件：不需要 app 在 pom 里配置，因此这是
  // 「jar 包冲突」唯一能落到所有 app 的检测手段（enforcer 需要 app 配规则，常常没有）。
  const out = [];
  const versions = new Map();
  const coordRe = /([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-]+):(?:jar|war|pom|bundle|zip):([^:\s]+)/g;
  for (const raw of String(txt).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/omitted for conflict with/i.test(line) || /version managed from .* omitted/i.test(line)) {
      out.push({ tool: "dependency_tree", rule: "omitted-for-conflict", level: "blocker", file: "pom.xml", line: 0, message: norm(line).slice(0, 260) });
      continue;
    }
    let m;
    coordRe.lastIndex = 0;
    while ((m = coordRe.exec(line))) {
      const key = m[1] + ":" + m[2];
      if (!versions.has(key)) versions.set(key, new Set());
      versions.get(key).add(m[3]);
    }
  }
  for (const [key, set] of versions) {
    if (set.size > 1) {
      out.push({
        tool: "dependency_tree",
        rule: "version-multi",
        level: "major",
        file: "pom.xml",
        line: 0,
        message: key + " 存在多个版本：" + Array.from(set).sort().join(" / ") + "（版本未收敛）",
      });
    }
  }
  return out;
}

function parseEnforcer(txt) {
  const out = [];
  for (const line of String(txt).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/Dependency convergence error for/i.test(t) || /Found Banned Dependency/i.test(t) || /Rule \d+: .*banned/i.test(t)) {
      out.push({ tool: "enforcer", rule: "dependency-conflict", level: "blocker", file: "pom.xml", line: 0, message: t.slice(0, 300) });
    } else if (/Require upper bound dependencies error/i.test(t)) {
      out.push({ tool: "enforcer", rule: "require-upper-bound", level: "major", file: "pom.xml", line: 0, message: t.slice(0, 300) });
    }
  }
  return out;
}

function parseDepAnalyze(txt) {
  const out = [];
  let section = "";
  for (const line of String(txt).split("\n")) {
    const t = line.trim();
    if (/^Unused declared dependencies/i.test(t)) { section = "unused"; continue; }
    if (/^Used undeclared dependencies/i.test(t)) { section = "undeclared"; continue; }
    if (/^\S.*:\s*$/.test(t) && !t.startsWith("-")) { section = ""; continue; }
    if (section && t.startsWith("-")) {
      out.push({
        tool: "dependency_analyze",
        rule: section === "unused" ? "unused-declared" : "used-undeclared",
        level: section === "unused" ? "minor" : "major",
        file: "pom.xml",
        line: 0,
        message: t.replace(/^-+\s*/, "").slice(0, 200),
      });
    }
  }
  return out;
}

function parseErrorProne(txt) {
  const out = [];
  const re = /^(.+?\.java):(\d+): error: \[([A-Za-z0-9_]+)\]\s*(.*)$/gm;
  let m;
  while ((m = re.exec(String(txt)))) {
    out.push({ tool: "errorprone", rule: m[3], level: "error", file: pathKey(m[1]), line: parseInt(m[2], 10), message: norm(m[4]) });
  }
  return out;
}

function parseArchunit(txt) {
  const out = [];
  for (const line of String(txt).split("\n")) {
    const t = line.trim();
    if (/Architecture Violation|was violated|layered architecture was violated/i.test(t)) {
      out.push({ tool: "archunit", rule: "architecture-rule", level: "error", file: "", line: 0, message: t.slice(0, 300) });
    }
  }
  return out;
}

function parseStatusJson(o) {
  const cov = {};
  for (const k of Object.keys(o || {})) {
    const v = o[k];
    cov[k] = typeof v === "string" ? v : (v && (v.state || (v.exit === 0 ? "passed" : "failed"))) || "passed";
  }
  return cov;
}

// ---------- 1. cr_begin ----------

async function crBegin(args) {
  const reqId = args && args.reqId;
  if (!reqId) throw new Error("缺少必填参数：reqId");

  const meta = await loadMeta(reqId);
  const allowed = ["developing", "cr-agent"];
  if (!allowed.includes(meta.status)) {
    const hint = ["cr-human", "cr-confirmed", "testing", "ready-release", "released"].includes(meta.status)
      ? "需求已进入 CR 之后阶段；如需改动请先执行 /change <变更描述>"
      : "开发尚未完成，请先执行 /dev <需求编号>";
    return { ok: false, reqId, status: meta.status, hint };
  }

  const state = await readJson(statePath(reqId), { round: 0, lastSha: null, lastGateOk: false, sonarUnavailableStreak: 0 });
  const round = (await maxRound(reqId)) + 1;

  let skip = false;
  let skipReason = "";
  if (args.headSha && state.lastSha === args.headSha && state.lastGateOk) {
    skip = true;
    skipReason = `同一 sha 已通过代码级评审（${args.headSha}），无需重复评审`;
  } else if (args.headSha && state.lastSha === args.headSha && !state.lastGateOk) {
    skipReason = "同一 sha 上一轮未通过，需继续本轮修复复核（不跳过）";
  }

  // 端归属（运营端 / 非运营端）由 L2 评审员据证据判定并出清单（scope.json）；人工可中途用 endScope 给建议。
  // 这里不做强制要求：未声明时不调整档位，宽严由 L2 的清单结论决定。兼容旧字段写法（运营后台→运营端）。
  const SCOPE_ALIAS = {
    "运营端": "运营端", "运营后台": "运营端",
    "非运营端": "非运营端", "交易链路": "非运营端",
    "批量任务": "批量任务", "内部工具": "内部工具",
  };
  const rawScope = args.endScope || meta.scene || "";
  const endScope = SCOPE_ALIAS[rawScope] || null;
  const diffStat = args.diffStat && Number.isFinite(Number(args.diffStat.additions))
    ? {
        files: Number(args.diffStat.files) || 0,
        additions: Number(args.diffStat.additions) || 0,
        deletions: Number(args.diffStat.deletions) || 0,
      }
    : null;
  const touchedMoney = !!args.touchedMoney;

  let profile = args.profile || "auto";
  if (!["lite", "std", "full"].includes(profile)) profile = "auto";
  if (profile === "auto") {
    if (!diffStat) profile = "std";
    else {
      const churn = diffStat.additions + diffStat.deletions;
      if (diffStat.files <= 1 && churn < 100) profile = "lite";
      else if (churn < 400) profile = "std";
      else profile = "full";
    }
    if (touchedMoney) profile = "full";
    if (endScope === "运营端" && profile === "full") profile = "std";
    if (endScope === "批量任务" && profile === "lite") profile = "std";
  }

  const views = profile === "lite" ? ["V1"] : profile === "std" ? ["V1", "V2"] : ["V1", "V2", "V3", "V4"];
  if (touchedMoney && !views.includes("V-money")) views.push("V-money");

  const prev = round > 1 ? await readJson(issuesPath(reqId, round - 1), { issues: [] }) : { issues: [] };
  const openPrev = (prev.issues || []).filter(i => !RESOLVED_STATUS.includes(i.status));

  const plan = {
    reqId,
    round,
    createdAt: nowMinute(),
    status: meta.status,
    endScope,
    profile,
    views,
    touchedMoney,
    diffStat,
    incremental: args.incremental || null,
    hasBaseline: await exists(baselinePath(reqId)),
    openFromPrev: openPrev.map(i => ({ fp: i.fp, level: i.level, r: i.r, file: i.file, line: i.line })),
    skip,
    skipReason,
  };

  if (!skip) {
    await writeJson(planPath(reqId, round), plan);
    await writeJson(statePath(reqId), { ...state, round, lastSha: args.headSha || state.lastSha || null });
  }

  return {
    ok: true,
    reqId,
    round,
    skip,
    skipReason: skipReason || undefined,
    profile,
    views,
    endScope,
    note: diffStat ? undefined : "未传 diffStat：按 std 定档（体量由 Agent 用 git diff --shortstat 提供）",
    openFromPrev: openPrev.length,
    planPath: skip ? undefined : planPath(reqId, round),
  };
}

// ---------- 2. cr_ingest ----------

async function crIngest(args) {
  const reqId = args && args.reqId;
  if (!reqId) throw new Error("缺少必填参数：reqId");
  await loadMeta(reqId);
  const round = await resolveRound(reqId, args.round);

  const plan = await readJson(planPath(reqId, round), {});
  const diffPath = args.diffPath || `${roundDir(reqId, round)}/diff.patch`;
  const rawDir = args.rawDir || `${roundDir(reqId, round)}/raw`;

  const diffText = (await exists(diffPath)) ? await readText(diffPath) : "";
  const add = parseDiff(diffText);

  const severity = await loadSeverity();
  const baseline = await readJson(baselinePath(reqId), { fps: [] });
  const baseSet = new Set(baseline.fps || []);
  const prevIssues = await readJson(issuesPath(reqId, round), { issues: [] });
  const prevByFp = new Map((prevIssues.issues || []).map(i => [i.fp, i]));

  const coverage = {};
  for (const t of EXPECTED_TOOLS) coverage[t] = "missing";

  const rawNames = await listNames(rawDir);
  const statusFile = rawNames.find(n => /status\.json$/i.test(String(n)));
  if (statusFile) Object.assign(coverage, parseStatusJson(await readJson(`${rawDir}/${statusFile}`, {})));

  const rawIssues = [];
  for (const name of rawNames) {
    const p = `${rawDir}/${name}`;
    const lower = String(name).toLowerCase();
    let txt = "";
    try { txt = await readText(p); } catch { continue; }

    if (lower.endsWith(".sarif") || lower.endsWith(".sarif.json")) {
      const got = parseSarif(txt);
      rawIssues.push(...got);
      for (const it of got) coverage[it.tool] = coverage[it.tool] === "missing" ? "passed" : coverage[it.tool];
    } else if (lower === "sonar.json") {
      rawIssues.push(...parseSonar(txt));
      coverage.sonar = "passed";
    } else if (lower.includes("enforcer")) {
      rawIssues.push(...parseEnforcer(txt));
      if (coverage.enforcer === "missing") coverage.enforcer = "passed";
    } else if (lower.includes("dependency-tree") || lower.includes("dep-tree")) {
      rawIssues.push(...parseDepTree(txt));
      if (coverage.dependency_tree === "missing") coverage.dependency_tree = "passed";
    } else if (lower.includes("dependency-analyze") || lower.includes("dep-analyze")) {
      rawIssues.push(...parseDepAnalyze(txt));
      if (coverage.dependency_analyze === "missing") coverage.dependency_analyze = "passed";
    } else if (lower.includes("errorprone") || lower.includes("error-prone")) {
      rawIssues.push(...parseErrorProne(txt));
      if (coverage.errorprone === "missing") coverage.errorprone = "passed";
    } else if (lower.includes("archunit")) {
      rawIssues.push(...parseArchunit(txt));
      if (coverage.archunit === "missing") coverage.archunit = "passed";
    } else if (lower.endsWith(".xml")) {
      let got = [];
      if (/<checkstyle/i.test(txt)) { got = parseCheckstyle(txt); coverage.checkstyle = "passed"; }
      else if (/<pmd/i.test(txt)) { got = parsePmd(txt); coverage.pmd = "passed"; }
      else if (/<BugCollection/i.test(txt)) { got = parseSpotbugs(txt); coverage.spotbugs = "passed"; }
      rawIssues.push(...got);
    }
  }

  const merged = new Map();
  let droppedNotInDiff = 0;
  let suppressedByBaseline = 0;

  for (const it of rawIssues) {
    const file = pathKey(it.file);
    // 仅对「行锚定」问题做 diff 过滤；pom/enforcer/archunit/sonar 门禁这类无行号结论不受 diff 范围限制
    if (add.files.size > 0 && it.line > 0 && file) {
      const known = add.files.has(file);
      if (!known || !add.files.get(file).has(it.line)) { droppedNotInDiff++; continue; }
    }

    const r = mapRule(it.tool, it.rule);
    let level = levelOf(severity, it.tool, it.level);
    if (!LEVELS.includes(level)) continue;
    // R6（无用代码）判定即 major：工具映射只作线索，不允许被降为 minor
    if (r === "R6" && level === "minor") level = "major";

    const message = norm(it.message) || norm(it.rule);
    const fp = fpOf(`${r}|${file}|${message}`);
    if (baseSet.has(fp)) { suppressedByBaseline++; continue; }

    if (merged.has(fp)) {
      const cur = merged.get(fp);
      if (!cur.occurrences.includes(it.line)) cur.occurrences.push(it.line);
      continue;
    }
    const prev = prevByFp.get(fp);
    merged.set(fp, {
      fp,
      r,
      level,
      tool: it.tool,
      rule: it.rule || "",
      file,
      line: it.line || 0,
      occurrences: [it.line || 0],
      message,
      evidence: `${it.tool}${it.rule ? ":" + it.rule : ""} @ ${file || "pom.xml"}${it.line ? ":" + it.line : ""}`,
      status: prev ? prev.status : "待修复",
      verified: prev ? prev.verified || null : null,
      note: prev ? prev.note || "" : "",
    });
  }

  const issues = Array.from(merged.values()).sort((a, b) => {
    const lv = LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level);
    return lv !== 0 ? lv : String(a.file).localeCompare(String(b.file));
  });

  const stats = { blocker: 0, major: 0, minor: 0, total: issues.length };
  const byTool = {};
  for (const i of issues) {
    stats[i.level]++;
    byTool[i.tool] = (byTool[i.tool] || 0) + 1;
  }

  const state = await readJson(statePath(reqId), {});
  const sonarState = coverage.sonar === "unavailable" || coverage.sonar === "missing" ? "bad" : "ok";
  const streak = sonarState === "bad" ? (Number(state.sonarUnavailableStreak) || 0) + 1 : 0;

  const out = {
    reqId,
    round,
    generatedAt: nowMinute(),
    endScope: plan.endScope || null,
    profile: plan.profile || "std",
    diff: add.stats,
    coverage,
    stats,
    byTool,
    filtered: { droppedNotInDiff, suppressedByBaseline },
    issues,
  };
  await writeJson(issuesPath(reqId, round), out);
  await writeJson(statePath(reqId), { ...state, sonarUnavailableStreak: streak });

  return { ok: true, reqId, round, stats, coverage, filtered: out.filtered, issuesPath: issuesPath(reqId, round), sonarUnavailableStreak: streak };
}

// ---------- 3. cr_rule ----------

async function crRule(args) {
  const { reqId, fp, action } = args || {};
  if (!reqId || !fp || !action) throw new Error("缺少必填参数：reqId / fp / action");
  if (!["downgrade", "waive"].includes(action)) throw new Error(`action 非法：${action}（downgrade | waive）`);
  if (action === "waive" && !norm(args.reason)) throw new Error("waive 必须提供 reason（无理由豁免会被拒绝）");
  if (action === "downgrade" && !LEVELS.includes(args.level)) throw new Error(`downgrade 必须提供目标 level：${LEVELS.join(" / ")}`);

  const round = await resolveRound(reqId, args.round);
  const data = await readJson(issuesPath(reqId, round), null);
  if (!data) throw new Error(`issues.json 不存在：${issuesPath(reqId, round)}（请先执行 cr_ingest）`);

  const target = (data.issues || []).find(i => i.fp === fp);
  if (!target) throw new Error(`未找到 fp=${fp}（本轮共 ${(data.issues || []).length} 条）`);

  const before = target.level;
  if (action === "downgrade") {
    target.level = args.level;
    target.note = `${target.note ? target.note + "；" : ""}降级 ${before}→${args.level}（${norm(args.reason) || "未填理由"}）`;
  } else {
    target.status = "豁免";
    target.note = `${target.note ? target.note + "；" : ""}豁免：${norm(args.reason)}${args.until ? "；期限/责任人：" + norm(args.until) : ""}`;
  }
  await writeJson(issuesPath(reqId, round), data);

  if (action === "waive") {
    let log = "";
    if (await exists(waiversPath(reqId))) log = await readText(waiversPath(reqId));
    else log = "| 时间 | 轮次 | fp | 级别 | 理由 | 期限/责任人 |\n|---|---|---|---|---|---|\n";
    log = log.replace(/\s*$/, "") + `\n| ${nowMinute()} | R-${pad2(round)} | ${fp} | ${before} | ${norm(args.reason)} | ${norm(args.until) || "未填"} |\n`;
    await pi.fs.writeText(waiversPath(reqId), log);
  }

  return { ok: true, reqId, round, fp, action, before, after: target.level, status: target.status };
}

// ---------- 4. cr_gate ----------

async function crGate(args) {
  const reqId = args && args.reqId;
  if (!reqId) throw new Error("缺少必填参数：reqId");
  await loadMeta(reqId);
  const round = await resolveRound(reqId, args.round);

  const data = await readJson(issuesPath(reqId, round), null);
  if (!data) {
    return { ok: false, reqId, round, reasons: ["issues.json 缺失：阶段一（L1 机械层）尚未完成"], counts: { blocker: 0, major: 0, minor: 0 } };
  }

  const open = (data.issues || []).filter(i => !RESOLVED_STATUS.includes(i.status));
  const openBlocker = open.filter(i => i.level === "blocker");
  const r6open = open.filter(i => i.r === "R6");
  const state = await readJson(statePath(reqId), {});
  const streak = Number(state.sonarUnavailableStreak) || 0;

  const reasons = [];
  if (openBlocker.length) reasons.push(`open blocker ${openBlocker.length} 条：${openBlocker.map(i => i.fp).join(", ")}`);
  if (r6open.length) reasons.push(`R6 无用代码未删除 ${r6open.length} 条（删除后需重跑 L1）`);
  if (streak >= 2) reasons.push(`sonar 连续 ${streak} 轮不可用，覆盖不足（需用户显式 waive）`);

  const counts = { blocker: 0, major: 0, minor: 0 };
  for (const i of open) counts[i.level] = (counts[i.level] || 0) + 1;

  const ok = reasons.length === 0;
  await writeJson(statePath(reqId), { ...state, lastGateOk: ok });
  return { ok, reqId, round, counts, openTotal: open.length, openBlocker: openBlocker.map(i => i.fp), reasons, coverage: data.coverage, issuedAt: nowMinute() };
}

// ---------- 5. cr_report ----------

function coverageTable(coverage) {
  const rows = ["| 工具 | 状态 |", "|---|---|"];
  for (const t of EXPECTED_TOOLS) rows.push(`| ${t} | ${coverage[t] || "missing"} |`);
  return rows.join("\n");
}

function rTable(issues) {
  const names = {
    R0: "依赖与包（含 BOM 托管）", R1: "整体结构合理性", R2: "分层架构", R3: "同层跨子域互调",
    R4: "分布式部署条件（按端归属判定）", R5: "资产与金额", R6: "无用代码", R7: "重复造轮子",
    R8: "语义冲突（取值口径）", R9: "冗余校验与分层校验", R10: "可读性", "R-SEC": "安全（注入/越权/明文/密钥）",
  };
  const rows = ["| 编号 | 检查项 | 结论 | 问题数 |", "|---|---|---|---|"];
  for (const k of Object.keys(names)) {
    const n = issues.filter(i => i.r === k && !RESOLVED_STATUS.includes(i.status)).length;
    rows.push(`| ${k} | ${names[k]} | ${n ? "问题" : "通过"} | ${n} |`);
  }
  return rows.join("\n");
}

function scopeTable(scope) {
  // scope.json 由 L2 评审员产出（{items:[{target,end,basis,confidence}], humanNote}），插件只负责渲染
  if (!scope || !Array.isArray(scope.items) || !scope.items.length) {
    return "_本轮未产出端归属清单（L2 未判定）：按非运营端从严处理_";
  }
  const rows = ["| 改动对象 | 端归属 | 判定依据 | 置信度 |", "|---|---|---|---|"];
  for (const i of scope.items) {
    rows.push(`| ${i.target || "-"} | ${i.end || "待确认"} | ${i.basis || "-"} | ${i.confidence || "-"} |`);
  }
  if (scope.humanNote) rows.push("", `> 人工建议：${scope.humanNote}`);
  const pending = scope.items.filter(i => !i.end || i.end === "待确认").length;
  if (pending) rows.push("", `> ${pending} 项待人工确认；未确认期间按非运营端从严。`);
  return rows.join("\n");
}

function issueTable(issues) {
  const rows = ["| 编号 | fp | 级别 | R 项 | 位置 | 问题 | 工具证据 | 状态 | 备注 |", "|---|---|---|---|---|---|---|---|---|"];
  issues.forEach((i, idx) => {
    const n = `CR${idx + 1}`;
    const pos = `${i.file || "-"}${i.line ? ":" + i.line : ""}`;
    const occ = (i.occurrences || []).length > 1 ? `（${(i.occurrences || []).length} 处）` : "";
    rows.push(`| ${n} | ${i.fp} | ${i.level} | ${i.r} | ${pos} | ${i.message}${occ} | ${i.evidence} | ${i.status} | ${i.note || ""} |`);
  });
  return rows.length > 2 ? rows.join("\n") : "_本轮无问题_";
}

function r6Table(issues) {
  const list = issues.filter(i => i.r === "R6");
  if (!list.length) return "_本轮未发现无用代码_";
  const rows = ["| 位置 | 判定依据 | 状态 |", "|---|---|---|"];
  for (const i of list) rows.push(`| ${i.file || "-"}${i.line ? ":" + i.line : ""} | ${i.evidence} | ${i.status === "已修复" || i.status === "已验证" ? "已删除" : "未删除"} |`);
  return rows.join("\n");
}

async function crReport(args) {
  const reqId = args && args.reqId;
  if (!reqId) throw new Error("缺少必填参数：reqId");
  const meta = await loadMeta(reqId);
  const round = await resolveRound(reqId, args.round);

  const plan = await readJson(planPath(reqId, round), {});
  const data = await readJson(issuesPath(reqId, round), null);
  if (!data) throw new Error(`issues.json 不存在：${issuesPath(reqId, round)}（请先执行 cr_ingest）`);

  const gate = await crGate({ reqId, round });
  const issues = data.issues || [];
  const open = issues.filter(i => !RESOLVED_STATUS.includes(i.status));
  const st = { blocker: 0, major: 0, minor: 0 };
  for (const i of open) st[i.level] = (st[i.level] || 0) + 1;

  const scope = await readJson(`${roundDir(reqId, round)}/scope.json`, null);
  const head = [
    `## 第 ${round} 轮`,
    "",
    `- 时间：${nowMinute()}`,
    `- 需求：${meta.title || reqId}`,
    `- 档位：${plan.profile || data.profile || "std"}${args.note ? "（" + args.note + "）" : ""}`,
    `- 端归属：${plan.endScope || "待 L2 判定（默认按非运营端从严）"}`,
    `- 视角：${(plan.views || ["V1"]).join(" + ")}`,
    `- 改动体量：${data.diff ? `${data.diff.files} 文件 / +${data.diff.additions} -${data.diff.deletions}` : "未提供"}`,
    `- 过滤：diff 外丢弃 ${data.filtered ? data.filtered.droppedNotInDiff : 0} 条，baseline 抑制 ${data.filtered ? data.filtered.suppressedByBaseline : 0} 条`,
    `- 结论：${gate.ok ? "通过" : "不通过"}`,
    "",
    "### L1 工具覆盖矩阵",
    "",
    coverageTable(data.coverage || {}),
    "",
    "### R 项结论",
    "",
    rTable(issues),
    "",
    "### 端归属清单",
    "",
    scopeTable(scope),
    "",
    "### 问题清单",
    "",
    issueTable(issues),
    "",
    "### R6 删除清单",
    "",
    r6Table(issues),
    "",
    "### 门禁结论",
    "",
    `- cr_gate.ok：${gate.ok}`,
    `- open：blocker ${st.blocker} / major ${st.major} / minor ${st.minor}`,
    gate.reasons && gate.reasons.length ? `- 未通过原因：${gate.reasons.join("；")}` : "- 未通过原因：无",
    gate.ok ? `- 可进入 /cr` : `- 不可进入 /cr`,
    "",
  ].join("\n");

  const p = reportPath(reqId);
  const mark = `## 第 ${round} 轮`;
  let existing = (await exists(p)) ? await readText(p) : "";
  if (!existing) {
    existing = `# 代码级评审报告 — ${meta.title || reqId}\n\n<!-- 由 gwb.pi-code-review 生成；与 06-cr-report.md 分工：本文件记代码级 R0–R10，06-cr-report.md 记架构一致性。 -->\n\n`;
  }
  const dup = existing.includes(mark);
  if (!dup) {
    const sumIdx = existing.indexOf("## 轮次汇总");
    if (sumIdx >= 0) existing = existing.slice(0, sumIdx).replace(/\s*$/, "\n\n") + head + "\n" + existing.slice(sumIdx);
    else existing = existing.replace(/\s*$/, "\n\n") + head;
    await pi.fs.writeText(p, existing);
  }

  const summaryLine = `CR-${round}: ${gate.ok ? "通过" : "不通过"}｜blocker ${st.blocker} / major ${st.major} / minor ${st.minor}｜档位 ${plan.profile || "std"}｜R6 删除 ${issues.filter(i => i.r === "R6").length} 条`;

  return { ok: true, reqId, round, reportPath: p, appended: !dup, duplicated: dup, gate: gate.ok, counts: st, summaryLine, openIssues: open.length };
}

// ---------- 6. cr_baseline ----------

async function crBaseline(args) {
  const { reqId, action } = args || {};
  if (!reqId || !action) throw new Error("缺少必填参数：reqId / action");
  await loadMeta(reqId);

  if (action === "status") {
    const b = await readJson(baselinePath(reqId), null);
    return { ok: true, reqId, frozen: !!b, size: b && b.fps ? b.fps.length : 0, frozenAt: b && b.frozenAt, fromRound: b && b.fromRound };
  }
  if (!["freeze", "update"].includes(action)) throw new Error(`action 非法：${action}（freeze | update | status）`);

  const round = await resolveRound(reqId, args.round);
  const data = await readJson(issuesPath(reqId, round), null);
  if (!data) throw new Error(`issues.json 不存在：${issuesPath(reqId, round)}`);

  const cur = new Set((data.issues || []).map(i => i.fp));
  const old = await readJson(baselinePath(reqId), { fps: [] });
  const oldSet = new Set(old.fps || []);

  if (action === "freeze" && oldSet.size > 0) {
    throw new Error(`基线已存在（${oldSet.size} 条）；如需增量合并请用 action=update`);
  }

  const merged = action === "freeze" ? cur : new Set([...oldSet, ...cur]);
  const added = [...merged].filter(f => !oldSet.has(f));
  const removed = [...oldSet].filter(f => !merged.has(f));

  await writeJson(baselinePath(reqId), { reqId, fps: [...merged], frozenAt: nowMinute(), fromRound: round, action });
  let log = "";
  if (await exists(baselineLogPath(reqId))) log = await readText(baselineLogPath(reqId));
  else log = "| 时间 | 动作 | 轮次 | 合并后 | 新增 | 移除 |\n|---|---|---|---|---|---|\n";
  log = log.replace(/\s*$/, "") + `\n| ${nowMinute()} | ${action} | R-${pad2(round)} | ${merged.size} | ${added.length} | ${removed.length} |\n`;
  await pi.fs.writeText(baselineLogPath(reqId), log);

  return { ok: true, reqId, action, round, size: merged.size, added: added.length, removed: removed.length, baselinePath: baselinePath(reqId) };
}

// ---------- 7. cr_profile ----------

async function crProfile(args) {
  const reqId = args && args.reqId;
  if (!reqId) throw new Error("缺少必填参数：reqId");
  await loadMeta(reqId);
  const round = await resolveRound(reqId, args.round);

  const plan = await readJson(planPath(reqId, round), {});
  const data = await readJson(issuesPath(reqId, round), { issues: [], diff: null, coverage: {} });
  const issues = data.issues || [];
  const open = issues.filter(i => !RESOLVED_STATUS.includes(i.status));

  let changed = Array.isArray(args.changedFiles) ? args.changedFiles.map(pathKey) : [];
  if (!changed.length) {
    const diffText = (await exists(`${roundDir(reqId, round)}/diff.patch`)) ? await readText(`${roundDir(reqId, round)}/diff.patch`) : "";
    changed = [...parseDiff(diffText).files.keys()];
  }
  const srcFiles = changed.filter(f => /\.(java|kt|go|ts|js|py)$/.test(f) && !/(^|\/)(test|tests)\//i.test(f) && !/Test\.(java|kt)$/.test(f));
  const testFiles = changed.filter(f => /(^|\/)(test|tests)\//i.test(f) || /Test\.(java|kt)$/.test(f));

  const additions = (data.diff && data.diff.additions) || (plan.diffStat && plan.diffStat.additions) || 0;
  const redlines = open.filter(i => i.level === "blocker").length;
  const density = additions > 0 ? Math.round((redlines / additions) * 1000 * 100) / 100 : 0;

  return {
    ok: true,
    reqId,
    round,
    profile: plan.profile || data.profile || "std",
    endScope: plan.endScope || null,
    changedFiles: changed.length,
    srcFiles: srcFiles.length,
    testFiles: testFiles.length,
    testGapFiles: testFiles.length === 0 && srcFiles.length > 0 ? srcFiles.slice(0, 20) : [],
    additions,
    open: { blocker: open.filter(i => i.level === "blocker").length, major: open.filter(i => i.level === "major").length, minor: open.filter(i => i.level === "minor").length },
    r6Delete: issues.filter(i => i.r === "R6").length,
    blockerDensityPerKLines: density,
    coverageGaps: Object.keys(data.coverage || {}).filter(k => ["missing", "unavailable"].includes(data.coverage[k])),
    priority: [
      srcFiles.length && testFiles.length === 0 ? "改动无对应测试文件：优先人工看边界" : null,
      density > 0 ? `红线密度 ${density}/千行：先看 blocker` : null,
      open.some(i => i.level === "major") ? "存在 major：确认是否接受延后" : null,
    ].filter(Boolean),
  };
}

// ---------- 工具注册 ----------

const TOOLS = [
  {
    name: "cr_begin",
    description: "开一轮代码级评审：校验 00-meta 状态、读取上轮 open 项、按改动体量定档、判定是否跳过，产出 reviews/R-NN/plan.json。端归属（运营端/非运营端）不靠参数，由 L2 评审员判定。/code-review 第一步必须调用。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "需求编号 REQ-YYYYMMDD-<slug>" },
        profile: { type: "string", description: "lite|std|full；缺省 auto" },
        diffStat: {
          type: "object",
          properties: {
            files: { type: "number" },
            additions: { type: "number" },
            deletions: { type: "number" },
          },
        },
        touchedMoney: { type: "boolean", description: "触及金额/资产则强制 full + V-money" },
        endScope: { type: "string", description: "可选：人工中途给的端归属建议（运营端|非运营端|批量任务|内部工具）。不传则由 L2 评审员判定，不做档位调整" },
        headSha: { type: "string" },
        incremental: { type: "string" },
      },
      required: ["reqId"],
    },
    execute: crBegin,
  },
  {
    name: "cr_ingest",
    description: "归一工具产物与 diff：统一 issue 模型、diff 行过滤、baseline 抑制、指纹去重、严重度映射与 R 项归类，产出 reviews/R-NN/issues.json 与覆盖矩阵。",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string" },
        round: { type: "number" },
        diffPath: { type: "string" },
        rawDir: { type: "string" },
      },
      required: ["reqId"],
    },
    execute: crIngest,
  },
  {
    name: "cr_rule",
    description: "规则仲裁：downgrade / waive 指定 fp；waive 必须给理由，写入 reviews/waivers.md 留痕。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string" },
        round: { type: "number" },
        fp: { type: "string" },
        action: { type: "string", enum: ["downgrade", "waive"] },
        level: { type: "string", enum: ["blocker", "major", "minor"] },
        reason: { type: "string" },
        until: { type: "string" },
      },
      required: ["reqId", "fp", "action"],
    },
    execute: crRule,
  },
  {
    name: "cr_gate",
    description: "门禁判定（物理拦截）：汇总 open blocker、未删除的 R6、覆盖缺口（sonar 连续不可用），返回 ok 与原因。/cr 前置必须 ok=true。",
    risk: "low",
    schema: {
      type: "object",
      properties: { reqId: { type: "string" }, round: { type: "number" } },
      required: ["reqId"],
    },
    execute: crGate,
  },
  {
    name: "cr_report",
    description: "渲染并追加 06a-code-review.md 的第 N 轮小节（不覆盖历史轮次），返回 SUMMARY 摘要行。",
    risk: "medium",
    schema: {
      type: "object",
      properties: { reqId: { type: "string" }, round: { type: "number" }, note: { type: "string" } },
      required: ["reqId"],
    },
    execute: crReport,
  },
  {
    name: "cr_baseline",
    description: "存量基线：freeze 冻结当前全部指纹（首次接入），update 增量合并并记录增删，status 查询。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string" },
        action: { type: "string", enum: ["freeze", "update", "status"] },
        round: { type: "number" },
      },
      required: ["reqId", "action"],
    },
    execute: crBaseline,
  },
  {
    name: "cr_profile",
    description: "改动画像：改动/测试文件数、无测试覆盖清单、blocker 密度、覆盖缺口与人工优先看什么。",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string" },
        round: { type: "number" },
        changedFiles: { type: "array", items: { type: "string" } },
      },
      required: ["reqId"],
    },
    execute: crProfile,
  },
];

async function onLoad() {
  for (const t of TOOLS) await pi.agent.registerTool(t);
}

async function onUnload() {
  for (const t of TOOLS) await pi.agent.unregisterTool(t.name);
}

module.exports = { onLoad, onUnload };
