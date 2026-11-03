/**
 * PI-Workflow Gates — pi-workflow 机械层门禁插件
 *
 * 把「需求建档 / 状态机门禁 / 状态流转 / EP-07 账本计数」从 Markdown 规则
 * 下沉为代码物理执行。判断类工作（设计/评审/CR）仍由角色 Agent 承担。
 *
 * 宿主注入全局 `pi`；文件操作经 pi.fs 网关，范围见 manifest.json 的 fs 段：
 * 读 requirements/** 与 workflow/**，写仅限 requirements/**。
 */

// ---------- 常量：状态机（与 workflow/ORCHESTRATOR.md 门禁表保持一致） ----------

const STATES = [
  "draft", "clarifying", "clarified", "designing", "reviewed", "confirmed",
  "planned", "developing", "cr-agent", "cr-human", "cr-confirmed",
  "testing", "ready-release", "released", "archived",
  "blocked", "change-requested",
];

// 命令 → 前置状态（命中即放行；hint 为拦截时给用户的话术）
const GATES = {
  "req-clarify": { expect: ["draft", "clarifying"], hint: "需求尚未建立，请先执行 /req-new" },
  "design": { expect: ["clarified", "designing"], hint: "需求尚未澄清，请先执行 /req-clarify" },
  "review": { expect: ["designing", "reviewed"], hint: "设计尚未开始，请先执行 /design" },
  "breakdown": { expect: ["confirmed", "planned"], hint: "方案与用例未经人工复审，请先在 /review 流程中完成人工复审确认" },
  "dev": { expect: ["planned", "developing"], hint: "任务尚未拆解，请先执行 /breakdown" },
  "cr": { expect: ["developing", "cr-agent", "cr-human"], hint: "开发尚未完成，请先执行 /dev" },
  "test-plan": { expect: ["cr-confirmed", "testing"], hint: "CR 尚未通过人工确认，请先执行 /cr" },
  "pre-release": { expect: ["testing", "ready-release"], hint: "测试未完成，请先执行 /test-plan" },
  "retro": { expect: ["released"], hint: "需求尚未发布，不能归档复盘" },
  "risk": { expect: ["*"] },
  "change": { expect: ["*"] },
};

// 状态机邻接表：from → 允许的 to；任意状态可进 blocked / change-requested
const FLOW = {
  "draft": ["clarifying"],
  "clarifying": ["clarified", "draft"],
  "clarified": ["designing"],
  "designing": ["reviewed", "designing"],
  "reviewed": ["confirmed", "designing"],
  "confirmed": ["planned"],
  "planned": ["developing"],
  "developing": ["cr-agent", "developing"],
  "cr-agent": ["cr-human", "developing"],
  "cr-human": ["cr-confirmed", "developing"],
  "cr-confirmed": ["testing"],
  "testing": ["ready-release", "testing"],
  "ready-release": ["released", "testing"],
  "released": ["archived"],
  "archived": [],
  "blocked": ["*"], // 解除阻塞可回任意状态，须 note 说明
  "change-requested": ["clarified", "designing", "developing", "cr-agent", "testing", "ready-release", "released", "planned"],
};

const SIDE_STATES = ["blocked", "change-requested"]; // 任意状态 → 这两个状态恒允许（note 必填）

// ---------- 工具函数 ----------

function pad(n) { return String(n).padStart(2, "0"); }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayCompact() { return today().replaceAll("-", ""); }

function nowMinute() {
  const d = new Date();
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function exists(path) {
  try { await pi.fs.stat(path); return true; } catch { return false; }
}

function metaPath(reqId) { return `requirements/${reqId}/00-meta.md`; }

async function readMeta(reqId) {
  const p = metaPath(reqId);
  if (!(await exists(p))) throw new Error(`需求档案不存在：${p}（请先执行 /req-new 建档）`);
  return pi.fs.readText(p);
}

/** 从 frontmatter 提取 status；要求文件以 --- 开头 */
function parseStatus(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error("00-meta.md 缺少 YAML frontmatter");
  const line = m[1].split("\n").find(l => /^status\s*:/.test(l.trim()));
  if (!line) throw new Error("00-meta.md frontmatter 缺少 status 字段");
  return line.split(":")[1].trim();
}

/** 替换 frontmatter 中的字段值 */
function setFrontmatter(content, key, value) {
  const re = new RegExp(`(^---\\n[\\s\\S]*?^${key}\\s*:\\s*).*$`, "m");
  if (!re.test(content)) throw new Error(`frontmatter 缺少字段：${key}`);
  return content.replace(re, `$1${value}`);
}

/** 解析过程指标表中某指标行的 [数值, 备注]；数值非数字按 0 计 */
function parseMetricRow(content, metric) {
  const re = new RegExp(`^\\|\\s*${metric}\\s*\\|([^|]*)\\|([^|]*)\\|$`, "m");
  const m = content.match(re);
  if (!m) throw new Error(`过程指标表缺少行：${metric}`);
  const raw = m[1].trim();
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : 0;
  return { n, remark: m[2].trim() };
}

/** 更新过程指标表某行的数值与备注（备注为追加式） */
function setMetricRow(content, metric, value, remarkAppend) {
  const re = new RegExp(`^(\\|\\s*${metric}\\s*\\|)([^|]*)\\|([^|]*)\\|$`, "m");
  const m = content.match(re);
  if (!m) throw new Error(`过程指标表缺少行：${metric}`);
  const oldRemark = m[3].trim();
  const remark = oldRemark && !/^<.*>$/.test(oldRemark)
    ? `${oldRemark}；${remarkAppend}`
    : remarkAppend;
  return content.replace(re, `$1 ${value} | ${remark} |`);
}

/** 向「状态变更日志」表末尾追加一行 */
function appendStatusLog(content, from, to, note) {
  if (!/^\|\s*时间\s*\|\s*从状态\s*\|/m.test(content)) {
    throw new Error("00-meta.md 缺少「状态变更日志」表");
  }
  const row = `| ${nowMinute()} | ${from} | ${to} | agent | ${note || "-"} |`;
  return content.replace(/\s*$/, "") + "\n" + row + "\n";
}

// ---------- 四个工具 ----------

async function reqInit(args) {
  const { title, slug } = args || {};
  if (!title || !slug) throw new Error("缺少必填参数：title / slug");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`slug 非法：${slug}（小写字母/数字/连字符，如 order-timeout）`);
  }
  const reqId = `REQ-${todayCompact()}-${slug}`;
  const dir = `requirements/${reqId}`;
  if (await exists(dir)) throw new Error(`需求档案已存在：${dir}`);

  const tplDir = "workflow/templates";
  const [metaTpl, intakeTpl, summaryTpl] = await Promise.all([
    pi.fs.readText(`${tplDir}/00-meta.md`),
    pi.fs.readText(`${tplDir}/01-intake.md`),
    pi.fs.readText(`${tplDir}/summary.md`),
  ]);

  const d = today();
  const meta = metaTpl
    .replaceAll("REQ-YYYYMMDD-<slug>", reqId)
    .replaceAll("<需求标题>", title)
    .replaceAll("<P0|P1|P2|P3>", args.priority || "P2")
    .replaceAll("<负责人>", args.owner || "待填写")
    .replaceAll("YYYY-MM-DD", d);

  await pi.fs.writeText(`${dir}/00-meta.md`, meta);
  await pi.fs.writeText(`${dir}/01-intake.md`, intakeTpl.replaceAll("REQ-YYYYMMDD-<slug>", reqId).replaceAll("<需求标题>", title));
  await pi.fs.writeText(`${dir}/SUMMARY.md`, summaryTpl.replaceAll("REQ-YYYYMMDD-<slug>", reqId).replaceAll("<需求标题>", title));

  return { ok: true, reqId, dir, status: "draft", files: ["00-meta.md", "01-intake.md", "SUMMARY.md"] };
}

async function stateCheck(args) {
  const { reqId, command } = args || {};
  if (!reqId || !command) throw new Error("缺少必填参数：reqId / command");
  const gate = GATES[command];
  if (!gate) throw new Error(`未知命令：${command}（可选：${Object.keys(GATES).join(" / ")}）`);
  const status = parseStatus(await readMeta(reqId));
  const ok = gate.expect.includes("*") || gate.expect.includes(status);
  return ok
    ? { ok: true, reqId, command, status }
    : { ok: false, reqId, command, status, expected: gate.expect, hint: gate.hint };
}

async function stateTransition(args) {
  const { reqId, to, note } = args || {};
  if (!reqId || !to) throw new Error("缺少必填参数：reqId / to");
  if (!STATES.includes(to)) throw new Error(`非法状态：${to}（可选：${STATES.join(" / ")}）`);
  if (SIDE_STATES.includes(to) && !note) throw new Error(`进入 ${to} 必须在 note 中写明原因`);

  let content = await readMeta(reqId);
  const from = parseStatus(content);

  const allowed = SIDE_STATES.includes(to)
    ? true
    : (FLOW[from] || []).includes("*") || (FLOW[from] || []).includes(to);
  if (!allowed) {
    return {
      ok: false, reqId, from, to,
      allowed: [...(FLOW[from] || []), ...SIDE_STATES],
      hint: `非法流转：${from} → ${to}。允许的目标：${[...(FLOW[from] || []), ...SIDE_STATES].join(" / ")}`,
    };
  }

  content = setFrontmatter(content, "status", to);
  content = setFrontmatter(content, "updated", today());
  content = appendStatusLog(content, from, to, note);
  await pi.fs.writeText(metaPath(reqId), content);
  return { ok: true, reqId, from, to, updated: today() };
}

async function metricsRecord(args) {
  const { reqId, kind, note } = args || {};
  if (!reqId || !kind) throw new Error("缺少必填参数：reqId / kind");
  if (kind === "human_reject" && !note) throw new Error("human_reject 必须在 note 中写明打回原因");

  let content = await readMeta(reqId);
  let result;

  if (kind === "cr_round") {
    const { n } = parseMetricRow(content, "CR 轮次");
    content = setMetricRow(content, "CR 轮次", n + 1, `${n + 1} = ${n} + 1`);
    result = { metric: "CR 轮次", value: n + 1, audit: `${n + 1} = ${n} + 1` };
  } else if (kind === "rework") {
    const { n } = parseMetricRow(content, "返工次数");
    content = setMetricRow(content, "返工次数", n + 1, note || `${n + 1} = ${n} + 1`);
    result = { metric: "返工次数", value: n + 1, audit: `${n + 1} = ${n} + 1` };
  } else if (kind === "human_reject") {
    const { n } = parseMetricRow(content, "返工次数"); // 人工打回同时计返工（EP-07）
    content = setMetricRow(content, "人工打回原因", note, today());
    content = setMetricRow(content, "返工次数", n + 1, `${n + 1} = ${n} + 1（人工打回）`);
    result = { metric: "人工打回原因", value: note, rework: n + 1 };
  } else {
    throw new Error(`非法 kind：${kind}（可选：cr_round / rework / human_reject）`);
  }

  await pi.fs.writeText(metaPath(reqId), content);
  return { ok: true, reqId, ...result };
}

// ---------- 注册 ----------

const TOOLS = [
  {
    name: "req_init",
    description: "创建需求档案：生成编号 REQ-YYYYMMDD-<slug>、创建 requirements/<编号>/ 目录并从 workflow/templates 拷贝 00-meta/01-intake/SUMMARY 模板（frontmatter 填好 id/title/status=draft/日期）。目录已存在则拒绝。/req-new 必须调用本工具建档，不得手工创建。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "需求标题（中文）" },
        slug: { type: "string", description: "需求英文 slug，小写字母数字与连字符，如 order-timeout" },
        owner: { type: "string", description: "负责人，缺省为「待填写」" },
        priority: { type: "string", description: "优先级 P0-P3，缺省 P2" },
      },
      required: ["title", "slug"],
    },
    execute: reqInit,
  },
  {
    name: "state_check",
    description: "阶段门禁校验（物理拦截）：读取 requirements/<reqId>/00-meta.md 的 status，校验是否满足指定命令的前置状态。返回 ok=false 时附 hint（应提示用户的「请先执行 /xxx」话术）。任何命令执行前必须先调本工具，ok=false 时禁止继续。",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "需求编号 REQ-YYYYMMDD-<slug>" },
        command: { type: "string", description: "命令名，如 design / review / breakdown / dev / cr / test-plan / pre-release / retro" },
      },
      required: ["reqId", "command"],
    },
    execute: stateCheck,
  },
  {
    name: "state_transition",
    description: "状态流转：校验流转合法性（按状态机邻接表），合法则更新 00-meta.md 的 status/updated 并向「状态变更日志」表追加一行。非法流转直接拒绝并返回允许的目标状态列表。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "需求编号" },
        to: { type: "string", description: "目标状态，如 clarified/designing/reviewed/confirmed/planned/developing/cr-agent/cr-human/cr-confirmed/testing/ready-release/released/archived/blocked/change-requested" },
        note: { type: "string", description: "备注；blocked/change-requested 必填原因" },
      },
      required: ["reqId", "to"],
    },
    execute: stateTransition,
  },
  {
    name: "metrics_record",
    description: "EP-07 账本计数：更新 00-meta.md 过程指标表。cr_round=CR 轮次 +1（备注自动写 N = N-1 + 1 可核算式）；rework=返工次数 +1；human_reject=人工打回原因追加一条（含日期，同时返工 +1）。禁止手工改这些数值。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "需求编号" },
        kind: { type: "string", enum: ["cr_round", "rework", "human_reject"], description: "计数类型" },
        note: { type: "string", description: "备注；human_reject 必填打回原因，rework 建议填阶段" },
      },
      required: ["reqId", "kind"],
    },
    execute: metricsRecord,
  },
];

async function onLoad() {
  for (const t of TOOLS) await pi.agent.registerTool(t);
}

async function onUnload() {
  for (const t of TOOLS) await pi.agent.unregisterTool(t.name);
}

module.exports = { onLoad, onUnload };
