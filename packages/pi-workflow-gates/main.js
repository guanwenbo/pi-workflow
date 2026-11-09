/**
 * PI-Workflow Gates — pi-workflow 机械层门禁插件
 *
 * 把「需求建档 / 状态机门禁 / 状态流转 / EP-07 账本计数」从 Markdown 规则
 * 下沉为代码物理执行。判断类工作（设计/评审/CR）仍由角色 Agent 承担。
 *
 * 宿主注入全局 `pi`；文件操作经 pi.fs 网关，范围见 manifest.json 的 fs 段：
 * 读 requirements/** 与 docs/**，写仅限 requirements/**。
 */

// ---------- 常量：状态机（与 docs/ORCHESTRATOR.md 门禁表保持一致） ----------

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
  // patched 2026-11-09：变更审批通过后允许回流 clarifying（原邻接表漏 clarifying，导致 change-requested → clarifying 被物理拒绝）
  "change-requested": ["clarifying", "clarified", "designing", "developing", "cr-agent", "testing", "ready-release", "released", "planned"],
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
  try { await pi.fs.stat(path); return true; } catch { /* 宿主 stat 不覆盖目录，用 list 兜底 */ }
  try { await pi.fs.list(path); return true; } catch { return false; }
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

/** 向「状态变更日志」表末尾追加一行（patched 2026-11-09：原实现把行追加到文件末尾而非表内） */
function appendStatusLog(content, from, to, note) {
  if (!/^\|\s*时间\s*\|\s*从状态\s*\|/m.test(content)) {
    throw new Error("00-meta.md 缺少「状态变更日志」表");
  }
  const row = `| ${nowMinute()} | ${from} | ${to} | agent | ${note || "-"} |`;
  const lines = content.split("\n");
  const head = lines.findIndex(l => /^\|\s*时间\s*\|\s*从状态\s*\|/.test(l));
  let last = head + 1;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^\s*\|/.test(lines[i])) last = i;
    else break;
  }
  lines.splice(last + 1, 0, row);
  return lines.join("\n");
}

// ---------- 跨项目注册中心（方案 C） ----------
// 存储：插件自己的数据目录（pi.plugin.getDataPath()），天然跨工作区共享；
// 镜像：每次变更同时写当前工作区的 requirements/.registry.json（面板只读它，不碰插件数据目录）。
// 语义：各项目的 00-meta.md 是唯一权威；注册中心是「镜像 + 跨项目关系层」，只告警不阻塞。

const MIRROR_PATH = "requirements/.registry.json";
const DONE_STATES = new Set(["released", "archived"]);

// 注册中心存在插件自己的数据目录，用原生 fs 读写——pi.fs 是「工作区」权限网关，管不到插件数据目录；
// 其他插件（clipboard-history / file-manager）写自己数据目录同样走原生 fs。镜像（工作区文件）仍走 pi.fs。
const nodeFs = require("node:fs");
const nodePath = require("node:path");

async function registryFile() {
  const dataPath = await pi.plugin.getDataPath();
  return `${dataPath}/registry.json`;
}

async function readRegistry() {
  try {
    const raw = nodeFs.readFileSync(await registryFile(), "utf8"); // 原生 fs：插件数据目录不在 pi.fs 网关范围内
    const reg = JSON.parse(raw);
    if (reg && reg.requirements && typeof reg.requirements === "object") return reg;
  } catch { /* 不存在或损坏则重建 */ }
  return { version: 1, requirements: {} };
}

async function writeRegistry(reg) {
  reg.updatedAt = new Date().toISOString();
  const raw = JSON.stringify(reg, null, 2);
  const rf = await registryFile();
  nodeFs.mkdirSync(nodePath.dirname(rf), { recursive: true });
  nodeFs.writeFileSync(rf, raw); // 原生 fs：插件数据目录
  // 镜像到所有已登记项目的工作区（面板读这里；跨项目视图才一致）。
  // pi.fs 以当前工作区为根，跨项目写须走绝对路径——宿主网关按 manifest fs.write 范围放行。
  const seen = new Set();
  for (const r of Object.values(reg.requirements)) {
    if (r.projectRoot && !seen.has(r.projectRoot)) {
      seen.add(r.projectRoot);
      try { await pi.fs.writeText(`${r.projectRoot}/${MIRROR_PATH}`, raw); } catch { /* 该项目当前不可写则跳过 */ }
    }
  }
  // 兜底：当前工作区（无登记项目根时也尽量留一份）
  try { await pi.fs.writeText(MIRROR_PATH, raw); } catch { /* best-effort */ }
}
/** 取当前工作区项目标识（名 + 根路径） */
async function currentProject() {
  try {
    const ws = await pi.workspace.get();
    const root = ws && (ws.path || ws.root || "");
    const name = root ? root.split("/").filter(Boolean).pop() : "unknown";
    return { name, root };
  } catch {
    return { name: "unknown", root: "" };
  }
}

async function registryRegister(reqId, extra) {
  const reg = await readRegistry();
  const proj = await currentProject();
  const existed = reg.requirements[reqId];
  reg.requirements[reqId] = {
    ...(existed || {}), // 保留 derivedFrom / originProject 等派生标记（req_derive 的幂等键依赖它们）
    project: proj.name,
    projectRoot: proj.root,
    status: (extra && extra.status) || "draft",
    title: (extra && extra.title) || "",
    dependsOn: (existed && existed.dependsOn) || [],
    registeredAt: (existed && existed.registeredAt) || new Date().toISOString(),
    awaitingCreate: false, // 建档动作本身即证明目标仓已有档案
    updatedAt: new Date().toISOString(),
  };
  await writeRegistry(reg);
  return reg.requirements[reqId];
}

async function registryMirrorStatus(reqId, status) {
  const reg = await readRegistry();
  if (!reg.requirements[reqId]) return false; // 未登记的老档案不强制
  reg.requirements[reqId].status = status;
  reg.requirements[reqId].updatedAt = new Date().toISOString();
  await writeRegistry(reg);
  return true;
}

/** 读 00-meta.md frontmatter 的 dependsOn 数组 */
function parseDependsOn(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const line = m[1].split("\n").find(l => /^dependsOn\s*:/.test(l.trim()));
  if (!line) return [];
  const raw = line.split(":").slice(1).join(":").trim();
  const arr = raw.match(/^\[(.*)\]$/);
  if (!arr) return [];
  return arr[1].split(",").map(s => s.trim()).filter(Boolean);
}

/** 回写 dependsOn 到 frontmatter（无前则插到 status 行后） */
function setDependsOn(content, deps) {
  const line = `dependsOn: [${deps.join(", ")}]`;
  if (/^dependsOn\s*:/m.test(content)) {
    return content.replace(/^dependsOn\s*:.*$/m, line);
  }
  return content.replace(/^(status\s*:.*)$/m, `$1\n${line}`);
}

/** 依赖告警（只告警不阻塞）：依赖项未 released/archived 即提醒 */
async function depWarnings(reqId) {
  const reg = await readRegistry();
  const me = reg.requirements[reqId];
  if (!me || !me.dependsOn.length) return [];
  return me.dependsOn
    .map(depId => ({ depId, dep: reg.requirements[depId] }))
    .filter(x => x.dep && !DONE_STATES.has(x.dep.status))
    .map(x => `依赖的 ${x.depId}（${x.dep.project}）当前状态 ${x.dep.status}，尚未发布——请人工把控节奏`);
}

async function registryDep(args) {
  const { reqId, action, depReqId } = args || {};
  if (!reqId || !action) throw new Error("缺少必填参数：reqId / action（add | remove | list）");
  const reg = await readRegistry();
  const me = reg.requirements[reqId];
  if (!me) throw new Error(`${reqId} 未在注册中心登记（请先在该项目用 /req-new 建档或确认插件已升级）`);

  if (action === "list") {
    const deps = (me.dependsOn || []).map(depId => {
      const d = reg.requirements[depId];
      return { reqId: depId, project: d ? d.project : "未登记", status: d ? d.status : "未知", done: d ? DONE_STATES.has(d.status) : false };
    });
    return { ok: true, reqId, dependsOn: deps };
  }

  if (!depReqId) throw new Error(`action=${action} 缺少 depReqId`);
  if (!reg.requirements[depReqId]) throw new Error(`被依赖的 ${depReqId} 未在注册中心登记（先在被依赖项目里建档/登记）`);
  if (depReqId === reqId) throw new Error("不允许依赖自己");

  const deps = new Set(me.dependsOn || []);
  if (action === "add") deps.add(depReqId);
  else if (action === "remove") deps.delete(depReqId);
  else throw new Error(`非法 action：${action}（add | remove | list）`);
  me.dependsOn = [...deps].sort();
  me.updatedAt = new Date().toISOString();

  // 双写：档案 frontmatter 同步（档案自包含可独立阅读）
  const content = await readMeta(reqId);
  await pi.fs.writeText(metaPath(reqId), setDependsOn(content, me.dependsOn));
  await writeRegistry(reg);

  const warnings = await depWarnings(reqId);
  return { ok: true, reqId, action, dependsOn: me.dependsOn, warnings };
}

// ---------- adopt_project：一键把目标仓接入 pi-workflow ----------
// 跨工作区/目标仓的写入走原生 node:fs（pi.fs 网关只管当前工作区）。
// 幂等：已接入则跳过；返回接入结果与需人工确认清单。

async function adoptProject(args) {
  const { projectPath } = args || {};
  if (!projectPath) throw new Error("缺少必填参数：projectPath（目标仓绝对路径）");
  if (!nodeFs.existsSync(projectPath)) throw new Error(`目标路径不存在：${projectPath}`);
  if (!nodeFs.existsSync(nodePath.join(projectPath, ".git"))) throw new Error(`目标不是 git 仓库（无 .git）：${projectPath}`);

  // 源资产：显式 sourceRoot / PI_WORKFLOW_HOME / 插件包内嵌脚手架（安装态）/ 仓库开发态
  const srcRoot = resolveScaffoldRoot(args && args.sourceRoot, projectPath);
  if (!srcRoot) {
    throw new Error(
      "找不到工作流源资产（需同时含 .pi/commands/req-new.md 与 docs/templates/00-meta.md）：" +
      "请在 pi-workflow 仓内运行，或用 sourceRoot 指定仓库根，或设置 PI_WORKFLOW_HOME"
    );
  }
  const checks = [];
  const needConfirm = [];

  // 0) 备份旧 docs（若目标仓已有 docs/ 且与源不同）
  const targetDocs = nodePath.join(projectPath, "docs");
  if (nodeFs.existsSync(targetDocs)) {
    const backup = nodePath.join(projectPath, ".workflow-backup-docs-" + Date.now());
    nodeFs.cpSync(targetDocs, backup, { recursive: true });
    checks.push(`已备份旧 docs 到 ${nodePath.basename(backup)}`);
    needConfirm.push(`旧 docs 已备份为 ${nodePath.basename(backup)}，确认无遗留后可删`);
  }

  // 1) 复制 .pi/commands
  const srcCmd = nodePath.join(srcRoot, ".pi", "commands");
  const dstCmd = nodePath.join(projectPath, ".pi", "commands");
  nodeFs.mkdirSync(nodePath.dirname(dstCmd), { recursive: true });
  nodeFs.cpSync(srcCmd, dstCmd, { recursive: true, force: true });
  checks.push(".pi/commands 已同步（" + nodeFs.readdirSync(dstCmd).length + " 个命令）");

  // 2) 复制 docs/（含 templates + 流程文档）
  nodeFs.cpSync(nodePath.join(srcRoot, "docs"), targetDocs, { recursive: true, force: true });
  checks.push("docs/ 已同步（含 templates）");

  // 3) requirements/README.md
  const reqDir = nodePath.join(projectPath, "requirements");
  nodeFs.mkdirSync(reqDir, { recursive: true });
  nodeFs.copyFileSync(nodePath.join(srcRoot, "requirements", "README.md"), nodePath.join(reqDir, "README.md"));
  checks.push("requirements/README.md 已就位");

  // 4) .gitignore 补镜像忽略
  const gi = nodePath.join(projectPath, ".gitignore");
  const giLine = "requirements/.registry.json";
  let giContent = nodeFs.existsSync(gi) ? nodeFs.readFileSync(gi, "utf8") : "";
  if (!giContent.split("\n").some(l => l.trim() === giLine)) {
    nodeFs.appendFileSync(gi, (giContent.endsWith("\n") || !giContent ? "" : "\n") + giLine + "\n");
    checks.push(".gitignore 已加 " + giLine);
  } else {
    checks.push(".gitignore 已含镜像忽略（跳过）");
  }

  // 5) 自检
  const verify = [
    nodePath.join(projectPath, "docs", "templates", "01-intake.md"),
    nodePath.join(projectPath, "docs", "templates", "00-meta.md"),
    nodePath.join(projectPath, ".pi", "commands", "req-new.md"),
  ];
  for (const f of verify) {
    if (!nodeFs.existsSync(f)) throw new Error("自检失败，缺少：" + f);
  }
  checks.push("自检通过（templates + req-new 命令在位）");

  return {
    ok: true,
    projectPath,
    projectName: nodePath.basename(projectPath),
    checks,
    needConfirm,
    next: "在该项目里用 /req-new 建档（会自动登记进跨项目注册中心）",
  };
}

async function registryList() {
  const reg = await readRegistry();
  const items = Object.entries(reg.requirements).map(([reqId, r]) => ({
    reqId, ...r, done: DONE_STATES.has(r.status),
    blockedBy: (r.dependsOn || []).filter(d => {
      const dep = reg.requirements[d];
      return dep && !DONE_STATES.has(dep.status);
    }),
  }));
  const byProject = {};
  for (const it of items) (byProject[it.project] = byProject[it.project] || []).push(it);
  return { ok: true, total: items.length, updatedAt: reg.updatedAt || null, byProject, items };
}

// ---------- req_derive：本仓发起跨项目承接（派生需求） ----------
// 动机：父需求在本仓、落地能力在另一个仓时，此前靠人工在多仓之间搬上下文。
// 语义：本仓父需求 dependsOn 派生出的目标仓子需求（父等子交付）。依赖只告警不阻塞。
// 边界：不在目标仓直接建档案——建档由目标仓 agent 用 /req-new 接力，避免跨仓双写冲突。

/** 定位工作流源资产根（必须同时含 .pi/commands/req-new.md 与 docs/templates/00-meta.md） */
function resolveScaffoldRoot(explicit, projectPath) {
  const candidates = [];
  if (explicit) candidates.push(nodePath.resolve(explicit));
  if (process.env.PI_WORKFLOW_HOME) candidates.push(nodePath.resolve(process.env.PI_WORKFLOW_HOME));
  candidates.push(nodePath.join(__dirname, "assets", "scaffold")); // 安装态：随插件包内嵌
  candidates.push(nodePath.resolve(__dirname, "..", "..")); // 开发态：仓库根
  if (projectPath) candidates.push(projectPath); // 兜底：目标仓本身即源资产
  for (const c of candidates) {
    const hasCmds = nodeFs.existsSync(nodePath.join(c, ".pi", "commands", "req-new.md"));
    const hasTpl = nodeFs.existsSync(nodePath.join(c, "docs", "templates", "00-meta.md"));
    if (hasCmds && hasTpl) return c;
  }
  return null;
}

/** 标题/编号 → 合法 slug（小写字母数字与连字符） */
function slugify(input, max) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max || 40)
    .replace(/-+$/g, "");
}

/** 目标仓解析：绝对路径直接用；否则按仓名（支持片段）在注册中心已登记项目里反查 */
async function resolveTargetProject(target) {
  if (!target) throw new Error("缺少必填参数：targetProject（目标仓绝对路径，或注册中心里已登记的仓名）");
  const known = {};
  for (const r of Object.values((await readRegistry()).requirements)) {
    // 同一仓的多条需求共享同一根路径，取值重复覆盖无副作用
    if (r.projectRoot && r.project) known[r.project] = r.projectRoot;
  }
  let root = "";
  if (nodePath.isAbsolute(target)) root = nodePath.resolve(target);
  else if (known[target]) root = known[target];
  else {
    const hit = Object.keys(known).filter(n => n.includes(target));
    if (hit.length === 1) root = known[hit[0]];
    else if (hit.length > 1) throw new Error(`目标仓名「${target}」有歧义：${hit.join(" / ")}——请写完整仓名或绝对路径`);
    else {
      throw new Error(
        `找不到目标仓「${target}」：既不是已登记仓（${Object.keys(known).join(" / ") || "无"}），也不是绝对路径。` +
          "请用绝对路径，或先在目标仓执行 /req-adopt"
      );
    }
  }
  if (!nodeFs.existsSync(root)) throw new Error(`目标仓路径不存在：${root}`);
  const name = nodePath.basename(root);
  const missing = [];
  if (!nodeFs.existsSync(nodePath.join(root, "docs", "templates", "01-intake.md"))) missing.push("docs/templates/01-intake.md");
  if (!nodeFs.existsSync(nodePath.join(root, ".pi", "commands", "req-new.md"))) missing.push(".pi/commands/req-new.md");
  if (missing.length) {
    throw new Error(`目标仓「${name}」尚未接入 pi-workflow（缺 ${missing.join("、")}）——请先执行 /req-adopt ${root}`);
  }
  return { name, root };
}

/** 幂等替换 markdown 二级小节：存在则整节替换，不存在则追加到文末 */
function upsertSection(content, heading, body) {
  const marker = `## ${heading}`;
  const lines = content.split("\n");
  const start = lines.findIndex(l => l.trim() === marker);
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) { end = i; break; }
    }
    const merged = [...lines.slice(0, start), marker, "", body.trim(), "", ...lines.slice(end)];
    return merged.join("\n").replace(/\n{3,}/g, "\n\n");
  }
  return content.trimEnd() + `\n\n${marker}\n\n${body.trim()}\n`;
}

/** 建档简报：目标仓 agent 读它即可用 /req-new 接力建档 */
function buildBriefing(ctx) {
  const qs = ctx.questions.length
    ? ctx.questions.map((q, i) => `- Q-${pad(i + 1)}：${q}`).join("\n")
    : "- （暂无，由目标仓在 /req-clarify 中补齐）";
  return `# 跨项目承接简报 — ${ctx.childTitle}

> 本简报在本仓需求 ${ctx.parentReqId} 派生时自动生成。目标仓 agent 读完即可建档；父需求只记录依赖，不复制档案正文。

## 派生关系

| 项 | 值 |
| --- | --- |
| 父需求 | ${ctx.parentReqId}（${ctx.parentTitle}） |
| 父需求所在仓 | ${ctx.originProject || "未知"} |
| 派生需求编号 | ${ctx.childReqId} |
| 目标仓 | ${ctx.target.name} |
| 目标仓路径 | ${ctx.target.root} |
| 依赖方向 | ${ctx.parentReqId} dependsOn ${ctx.childReqId}（父等子交付；只告警不阻塞，节奏人工把控） |

## 目标仓建档指令

在 ${ctx.target.name} 仓的 Agent 中执行 \`/req-new\`，标题用「${ctx.childTitle}」，slug 用 \`${ctx.childSlug}\`。

预期编号为 \`${ctx.childReqId}\`；跨天建档会按当天日期重新生成编号，属正常。
建档后确认 \`requirements/<编号>/00-meta.md\` 的 frontmatter 为 \`status: draft\`。

## 需要目标仓承接的范围

${(ctx.note || "（待补充：父需求交给目标仓的接口/能力边界）").trim()}

## 待目标仓答复的问题

${qs}

## 建档后的回执

1. 在目标仓执行 \`/req-clarify\` 澄清本子需求；
2. 回到父需求仓，在本仓档案 \`01-intake.md\` 的「跨项目承接记录」核对状态（req_derive 自动维护）；
3. 子需求 released 后，父需求的依赖告警自动消失。
`;
}

async function reqDerive(args) {
  const { reqId, targetProject, title, slug, note, questions } = args || {};
  if (!reqId) throw new Error("缺少必填参数：reqId（本仓父需求编号）");
  const parentMeta = await readMeta(reqId); // 档案不存在会直接抛「请先 /req-new 建档」
  const target = await resolveTargetProject(targetProject);
  const proj = await currentProject();
  if (proj.root && nodePath.resolve(proj.root) === nodePath.resolve(target.root)) {
    throw new Error(`派生目标与当前仓相同（${target.name}）——同仓拆分请用 /breakdown，跨仓承接才用 /req-derive`);
  }

  // 父需求标题取 frontmatter 的 title；缺省退回编号
  const tm = parentMeta.match(/^---\n[\s\S]*?^title\s*:\s*(.*)$/m);
  const parentTitle = tm ? tm[1].trim() : reqId;
  const parentSlug = reqId.replace(/^REQ-\d{8}-/, "");
  const childTitle = (title && String(title).trim()) || `${parentTitle}（${target.name} 侧）`;
  const childSlug = (slug && String(slug).trim()) || slugify(`${parentSlug}-${target.name}`, 40);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(childSlug)) {
    throw new Error(`slug 非法：${childSlug}（小写字母/数字/连字符，如 order-api-provider）`);
  }

  const reg = await readRegistry();
  if (!reg.requirements[reqId]) {
    throw new Error(`${reqId} 未在跨项目注册中心登记——请先在本仓重新 /req-new 建档（或手工补登记）后再派生`);
  }

  // 幂等键 = 父需求 + 目标仓：跨天重跑复用已派生编号，不会产生重复子需求
  const existedId = Object.keys(reg.requirements).find(
    id => reg.requirements[id].derivedFrom === reqId && reg.requirements[id].project === target.name
  );
  const childReqId = existedId || `REQ-${todayCompact()}-${childSlug}`;
  const childMetaAbs = nodePath.join(target.root, "requirements", childReqId, "00-meta.md");
  const childAdopted = nodeFs.existsSync(childMetaAbs); // 目标仓 agent 是否已完成接力建档

  const isNew = !reg.requirements[childReqId];
  if (isNew) {
    reg.requirements[childReqId] = {
      project: target.name,
      projectRoot: target.root,
      status: "draft",
      title: childTitle,
      dependsOn: [],
      derivedFrom: reqId, // 幂等键之一
      originProject: proj.name, // 父需求所在仓（简报与看板都要用）
      awaitingCreate: !childAdopted,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } else {
    reg.requirements[childReqId].awaitingCreate = !childAdopted;
    reg.requirements[childReqId].updatedAt = new Date().toISOString();
  }

  // 依赖双写：注册中心 + 本仓 frontmatter（父 → 子，语义为父等子）
  const deps = [...new Set([...parseDependsOn(parentMeta), childReqId])].sort();
  await pi.fs.writeText(metaPath(reqId), setDependsOn(parentMeta, deps));
  reg.requirements[reqId].dependsOn = deps;
  reg.requirements[reqId].updatedAt = new Date().toISOString();
  await writeRegistry(reg);

  // 简报双份：本仓留档（可追可读）+ 目标仓 inbox（目标仓 agent 的接力入口）
  const qs = (Array.isArray(questions) ? questions : []).map(q => String(q).trim()).filter(Boolean);
  const briefing = buildBriefing({
    parentReqId: reqId, parentTitle, originProject: proj.name,
    childReqId, childTitle, childSlug, target, note, questions: qs,
  });
  const localBriefing = `requirements/${reqId}/derive/${childReqId}.md`;
  await pi.fs.writeText(localBriefing, briefing);
  const inboxDir = nodePath.join(target.root, "requirements", ".inbox");
  nodeFs.mkdirSync(inboxDir, { recursive: true });
  const inboxPath = nodePath.join(inboxDir, `${childReqId}.md`);
  nodeFs.writeFileSync(inboxPath, briefing); // 目标仓在工作区之外，只能走原生 fs

  // 本仓 01-intake 的「跨项目承接记录」：按注册中心重算，人工可直接改回来
  const intakePath = `requirements/${reqId}/01-intake.md`;
  let intakeUpdated = false;
  if (await exists(intakePath)) {
    const rows = Object.keys(reg.requirements)
      .filter(id => reg.requirements[id].derivedFrom === reqId)
      .sort()
      .map(id => {
        const r = reg.requirements[id];
        const done = !!r.projectRoot && nodeFs.existsSync(nodePath.join(r.projectRoot, "requirements", id, "00-meta.md"));
        return `| ${id} | ${r.project} | ${done ? "已建档" : "待目标仓 /req-new"} |`;
      });
    const body = [
      "<!-- req_derive 自动维护：本需求派生出的跨项目子需求。依赖只告警不阻塞，节奏由人工把控。 -->",
      "| 派生需求 | 目标仓 | 建档状态 |",
      "| --- | --- | --- |",
      ...rows,
    ].join("\n");
    await pi.fs.writeText(intakePath, upsertSection(await pi.fs.readText(intakePath), "跨项目承接记录", body));
    intakeUpdated = true;
  }

  return {
    ok: true,
    reqId,
    parentTitle,
    derivedReqId: childReqId,
    derivedTitle: childTitle,
    derivedSlug: childSlug,
    targetProject: target.name,
    targetRoot: target.root,
    created: isNew,
    alreadyAdopted: childAdopted,
    dependsOn: deps,
    files: { localBriefing, inbox: inboxPath, intakeUpdated },
    pendingQuestions: qs,
    next: childAdopted
      ? `目标仓已建档 ${childReqId}，可直接在 ${target.name} 执行 /req-clarify`
      : `在 ${target.name} 仓执行 /req-new（简报已放到该仓 requirements/.inbox/${childReqId}.md）`,
    warnings: await depWarnings(reqId),
  };
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

  const tplCandidates = ["docs/templates", "workflow/templates"];
  let tplDir = null;
  for (const c of tplCandidates) {
    if (await exists(c)) { tplDir = c; break; }
  }
  if (!tplDir) throw new Error("找不到模板目录：docs/templates（旧布局 workflow/templates）");
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

  // 建档即登记进跨项目注册中心（编号全局唯一由此保证）
  await registryRegister(reqId, { status: "draft", title });

  return { ok: true, reqId, dir, status: "draft", files: ["00-meta.md", "01-intake.md", "SUMMARY.md"] };
}

async function stateCheck(args) {
  const { reqId, command } = args || {};
  if (!reqId || !command) throw new Error("缺少必填参数：reqId / command");
  const gate = GATES[command];
  if (!gate) throw new Error(`未知命令：${command}（可选：${Object.keys(GATES).join(" / ")}）`);
  const status = parseStatus(await readMeta(reqId));
  const warnings = await depWarnings(reqId);
  const ok = gate.expect.includes("*") || gate.expect.includes(status);
  return ok
    ? { ok: true, reqId, command, status, warnings }
    : { ok: false, reqId, command, status, expected: gate.expect, hint: gate.hint, warnings };
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
  await registryMirrorStatus(reqId, to); // 镜像到注册中心（跨项目视图）
  return { ok: true, reqId, from, to, updated: today() };
}

// ---------- layer_scan：分层与域间依赖物理扫描（Java） ----------

const SKIP_DIRS = new Set([".git", "target", "node_modules", "dist", "build", ".idea", ".workflow-core"]);

async function walkJava(dir, acc) {
  let entries;
  try { entries = await pi.fs.list(dir); } catch { return acc; }
  for (const e of entries) {
    if (e.isDirectory) {
      if (!SKIP_DIRS.has(e.name)) await walkJava(e.path, acc);
    } else if (e.name.endsWith(".java")) {
      acc.push(e.path);
    }
  }
  return acc;
}

function parseJava(content) {
  const pkg = (content.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || "";
  const cls = (content.match(/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+(\w+)/m)
    || content.match(/^\s*(?:class|interface|enum|record)\s+(\w+)/m) || [])[1] || "";
  const imports = [];
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m;
  while ((m = re.exec(content)) !== null) imports.push(m[1]);
  return { pkg, cls, imports };
}

async function layerScan(args) {
  const { basePackage, layers, domains, assembly, files, srcPath } = args || {};
  if (!basePackage || !Array.isArray(layers) || layers.length < 2) {
    throw new Error("缺少必填参数：basePackage / layers（至少两层，按调用顺序从上到下）");
  }
  const layerRegex = layers.map(l => ({ name: l.name, res: l.patterns.map(p => new RegExp(p)) }));
  const layerOf = pkg => {
    const s = pkg.endsWith(".") ? pkg : pkg + "."; // 补尾点：让「.dao.」类正则也能命中末尾段
    for (const l of layerRegex) if (l.res.some(r => r.test(s))) return l.name;
    return null;
  };
  const domainOf = fqn => {
    if (!domains) return null;
    for (const [name, prefix] of Object.entries(domains)) if (fqn.startsWith(prefix)) return name;
    return null;
  };
  const isAssembly = pkg => (assembly || []).some(p => pkg.startsWith(p));

  // 收集文件（全量或增量）；默认排除测试代码（src/test/ 不受分层门禁约束，可用 includeTests 放开）
  const rawFiles = Array.isArray(files) && files.length
    ? files.filter(f => f.endsWith(".java"))
    : await walkJava(srcPath || ".", []);
  const javaFiles = args.includeTests ? rawFiles : rawFiles.filter(f => !/\/src\/test\//.test("/" + f));

  // 解析 + 建立 FQN → 文件映射
  const units = [];
  for (const path of javaFiles) {
    let content;
    try { content = await pi.fs.readText(path); } catch { continue; }
    const { pkg, cls, imports } = parseJava(content);
    units.push({ path, pkg, cls, fqn: pkg && cls ? `${pkg}.${cls}` : null, imports });
  }
  const fqnToFile = new Map(units.filter(u => u.fqn).map(u => [u.fqn, u.path]));

  const violations = [];
  const layerIdx = name => layers.findIndex(l => l.name === name);

  const allowRes = (args.allow || []).map(p => new RegExp(p)); // 豁免：如接口定义放在业务层、实现在外部依赖层的 SPI 模式
  for (const u of units) {
    const srcLayer = layerOf(u.pkg);
    const srcDomain = domainOf(u.pkg);
    for (const imp of u.imports) {
      if (!imp.startsWith(basePackage)) continue; // 只看项目内部依赖
      if (allowRes.some(r => r.test(imp))) continue; // 豁免规则（如 SPI 接口）
      // ① 分层方向：只允许上层调下层（layers 数组索引小=上层）
      if (srcLayer) {
        const targetPkg = imp.replace(/\.[A-Z]\w*$/, ""); // 去掉类名
        const dstLayer = layerOf(imp) || layerOf(targetPkg);
        if (dstLayer && layerIdx(dstLayer) < layerIdx(srcLayer)) {
          violations.push({ rule: "layer-reverse", level: "blocker", file: u.path, detail: `${u.pkg}（${srcLayer}层）依赖 ${imp}（${dstLayer}层）：下层不允许调上层/逆向依赖` });
        }
      }
      // ② 域间直接调用：跨域必须经组装层
      if (srcDomain) {
        const dstDomain = domainOf(imp);
        if (dstDomain && dstDomain !== srcDomain && !isAssembly(u.pkg)) {
          violations.push({ rule: "domain-cross", level: "blocker", file: u.path, detail: `${u.pkg}（${srcDomain}域）直接依赖 ${imp}（${dstDomain}域）：跨域调用必须经上层组装` });
        }
      }
    }
  }

  // ③ 类级循环依赖（项目内 FQN 图，DFS 找环）
  const graph = new Map();
  for (const u of units) {
    if (!u.fqn) continue;
    const edges = u.imports.filter(i => fqnToFile.has(i));
    graph.set(u.fqn, edges);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...graph.keys()].map(k => [k, WHITE]));
  const stack = [];
  const cycles = new Set();
  const dfs = node => {
    color.set(node, GRAY); stack.push(node);
    for (const next of graph.get(node) || []) {
      if (color.get(next) === GRAY) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next).join(" → ");
        cycles.add(cycle);
      } else if (color.get(next) === WHITE) dfs(next);
    }
    stack.pop(); color.set(node, BLACK);
  };
  for (const k of graph.keys()) if (color.get(k) === WHITE) dfs(k);
  for (const c of cycles) {
    violations.push({ rule: "circular-dep", level: "blocker", file: c.split(" → ")[0], detail: `类级循环依赖：${c}` });
  }

  return {
    ok: violations.length === 0,
    scanned: units.length,
    basePackage,
    blockerCount: violations.length,
    violations,
  };
}

// ---------- chg_next：变更编号自增 ----------

async function chgNext(args) {
  const { reqId } = args || {};
  if (!reqId) throw new Error("缺少必填参数：reqId");
  const p = `requirements/${reqId}/changes/CHANGES.md`;
  if (!(await exists(p))) return { ok: true, reqId, next: "CHG-01", existing: [] };
  const content = await pi.fs.readText(p);
  const nums = [...content.matchAll(/CHG-(\d+)/g)].map(m => parseInt(m[1], 10));
  const max = nums.length ? Math.max(...nums) : 0;
  return { ok: true, reqId, next: `CHG-${String(max + 1).padStart(2, "0")}`, maxExisting: max ? `CHG-${String(max).padStart(2, "0")}` : null };
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
    description: "创建需求档案：生成编号 REQ-YYYYMMDD-<slug>、创建 requirements/<编号>/ 目录并从 docs/templates 拷贝 00-meta/01-intake/SUMMARY 模板（frontmatter 填好 id/title/status=draft/日期）。目录已存在则拒绝。/req-new 必须调用本工具建档，不得手工创建。",
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
  {
    name: "layer_scan",
    description: "分层与域间依赖物理扫描（Java）：按包名正则判定每个类的层与所属域，检查①下层调上层/逆向依赖 ②域间直接调用（跨域必须经组装层）③类级循环依赖，全部输出为 blocker 清单。CR 第零阶段与固定检查项①②⑤⑫应优先调用本工具，不得只靠肉眼排查。",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        basePackage: { type: "string", description: "项目根包名，如 com.jd.gw.card.center；只分析该前缀的 import" },
        srcPath: { type: "string", description: "扫描根目录（相对工作区），缺省为工作区根" },
        layers: {
          type: "array",
          description: "层定义，按调用顺序从上到下；patterns 命中类的 package 即归该层",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "层名，如 api / business / external" },
              patterns: { type: "array", items: { type: "string" }, description: "包名正则，如 [\"controller|facade|consumer|listener|job\"]" },
            },
            required: ["name", "patterns"],
          },
        },
        domains: { type: "object", description: "域名 → 包前缀映射，如 {\"user\":\"com.jd.gw.user\"}；不传则跳过域间检查" },
        assembly: { type: "array", items: { type: "string" }, description: "组装层包前缀（允许跨域调用），如 [\"com.jd.gw.app.assembly\"]" },
        files: { type: "array", items: { type: "string" }, description: "增量模式：只扫描这些 .java 文件（相对工作区路径）" },
      },
      required: ["basePackage", "layers"],
    },
    execute: layerScan,
  },
  {
    name: "chg_next",
    description: "变更编号自增：读取 requirements/<reqId>/changes/CHANGES.md，返回最大 CHG-NN + 1（无台账时返回 CHG-01）。/change 创建变更单前必须调用，禁止手数编号。",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "需求编号 REQ-YYYYMMDD-<slug>" },
      },
      required: ["reqId"],
    },
    execute: chgNext,
  },
  {
    name: "registry_dep",
    description: "跨项目依赖管理（只告警不阻塞）：add 建立 REQ 间依赖（双写注册中心与本档案 frontmatter dependsOn），remove 移除，list 查看依赖及其最新状态。返回 warnings 列出尚未发布的依赖项，供人工把控节奏。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "需求编号 REQ-YYYYMMDD-<slug>" },
        action: { type: "string", enum: ["add", "remove", "list"], description: "操作类型" },
        depReqId: { type: "string", description: "被依赖的需求编号（add/remove 必填；对方须已在注册中心登记）" },
      },
      required: ["reqId", "action"],
    },
    execute: registryDep,
  },
  {
    name: "registry_list",
    description: "跨项目需求全景：返回注册中心里所有项目的需求（按项目分组，含状态、dependsOn、blockedBy 未发布依赖）。面板与父 Agent 用来掌握跨项目节奏。",
    risk: "low",
    schema: { type: "object", properties: {} },
    execute: registryList,
  },
  {
    name: "adopt_project",
    description: "一键接入：把目标 git 仓库接入 pi-workflow（同步 .pi/commands + docs/ + requirements/README.md，补 .gitignore 忽略镜像，自检三件套）。幂等：重复执行只覆盖同步，旧 docs 会备份。跨仓写入走原生 fs，因此需要在目标仓所在机器本地执行。新仓接入必须先调本工具，禁止手工复制目录。",
    risk: "high",
    schema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "目标仓绝对路径（必须是已有 .git 的 git 仓库）" },
        sourceRoot: { type: "string", description: "工作流源资产根（含 .pi/commands 与 docs/templates 的仓根）；缺省自动探测插件内嵌脚手架 / 当前仓库" },
      },
      required: ["projectPath"],
    },
    execute: adoptProject,
  },
  {
    name: "req_derive",
    description: "跨项目承接（派生需求）：本仓父需求发起到目标仓的子需求承接。校验目标仓已接入 → 生成建档简报（本仓留档 + 目标仓 requirements/.inbox/）→ 父需求 dependsOn 挂到派生子需求（只告警不阻塞）→ 回填本仓 01-intake 的「跨项目承接记录」。幂等：同一父需求 + 同一目标仓重跑复用已派生编号。不在目标仓直接建档——建档由目标仓 agent 用 /req-new 接力。",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        reqId: { type: "string", description: "本仓父需求编号 REQ-YYYYMMDD-<slug>" },
        targetProject: { type: "string", description: "目标仓绝对路径，或注册中心里已登记的仓名（支持片段匹配）" },
        title: { type: "string", description: "派生子需求标题；缺省「<父需求标题>（<目标仓> 侧）」" },
        slug: { type: "string", description: "派生子需求 slug；缺省由父 slug + 目标仓名生成" },
        note: { type: "string", description: "交给目标仓承接的范围（接口/能力边界），写入简报" },
        questions: { type: "array", items: { type: "string" }, description: "待目标仓答复的待定项，写入简报 Q 清单" },
      },
      required: ["reqId", "targetProject"],
    },
    execute: reqDerive,
  },
];

const DASHBOARD_COMMAND = "gwb.pi-workflow-gates.dashboard";

async function onLoad() {
  for (const t of TOOLS) await pi.agent.registerTool(t);
  // 面板打开入口：命令面板搜「需求看板」
  await pi.commands.register({ id: DASHBOARD_COMMAND, title: "打开需求看板 / PI-Workflow Dashboard", run: () => pi.ui.openPanel() });
}

async function onUnload() {
  for (const t of TOOLS) await pi.agent.unregisterTool(t.name);
  await pi.commands.unregister(DASHBOARD_COMMAND);
}

/**
 * 面板/侧栏视图的数据通道：invoke("dashboard.data")。
 * 面板读不了工作区外的插件数据目录（fs 网关限 workspace 根），
 * 由插件进程用原生 fs 读全局注册中心返回——天然全局，不受当前工作区限制。
 */
async function onPanelInvoke(channel, payload) {
  if (channel === "dashboard.data") {
    const data = await registryList();
    const proj = await currentProject();
    return { ...data, currentProject: proj.name, currentRoot: proj.root };
  }
  if (channel === "dashboard.ping") return { ok: true };
  throw new Error(`unknown panel channel: ${channel}`);
}

module.exports = { onLoad, onUnload, onPanelInvoke };
