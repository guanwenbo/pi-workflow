/**
 * 文档级机械检查：design_lint / trace_matrix / analyze / converge。
 *
 * 为什么单独一个文件：main.js 已 1600+ 行，检查逻辑是纯文本解析、无副作用，
 * 与门禁工具分开便于单独测。全部用 global pi.fs（只读，不写工作区）。
 */

const DOC = {
  meta: "00-meta.md",
  intake: "01-intake.md",
  clarify: "02-clarification.md",
  design: "03-design.md",
  tasks: "05-tasks.md",
  testPlan: "08-test-plan.md",
};

const DESIGN_SECTIONS = ["需求背景", "业务流程", "领域划分", "实体设计", "数据建模", "落地实现", "边界场景"];

// 主链路文档禁止出现的过程性内容（过程一律进 log/YYYY-MM-DD.md 或 04/06）
const PROCESS_HEADINGS = /^##+\s*.*(变更记录|修订历史|评审意见|讨论记录|历史记录|过程记录)/m;

// 调用链路表必须覆盖的列（缺一即不完备）
const LINK_COLUMNS = ["上下游", "协议", "量级", "超时", "降级", "幂等", "事务边界", "SLO"];

// 套话：写文档时删掉，读者不需要
const FILLERS = ["为了", "从而", "综上所述", "接下来我们", "值得注意的是", "需要注意的是", "通过…的方式"];

// 自造词候选的构词后缀：命中且术语表未登记就提示（不是硬禁，要求给释义或改用原词）
const INVENTED_SUFFIX = /[\u4e00-\u9fa5]{2,}(服务|能力|中心|引擎|模块|平台|网关|中台|域)$/;

// 通用词白名单：不该被当成自造词报出来
const COMMON_TERMS = new Set([
  "业务服务", "基础服务", "下游服务", "上游服务", "公共服务", "外部服务", "内部服务",
  "业务模块", "基础模块", "核心模块", "业务平台", "数据平台", "技术平台", "业务域", "数据域",
]);

// 全部阈值集中一处：文档、模板、测试都读它，改数字只改这里
const LIMITS = {
  paragraphSentences: 3,   // 一段最多 3 句
  listItems: 7,            // 一组列表最多 7 项
  designLines: 420,        // 单份设计文档参考行数
  commandMaxBytes: 12000,  // 单条命令模板体积上限
  taskLinesHint: 500,      // 一个任务 ≈ 一次会话的改动行数（写进文档，不机检）
  summaryLines: 5,         // SUMMARY 每阶段行数
};

// ---------- 通用解析 ----------

async function readDoc(reqId, name) {
  try { return await pi.fs.readText(`requirements/${reqId}/${name}`); } catch { return null; }
}

function frontmatter(text) {
  const m = String(text || "").match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * 取「某章节」正文：支持 1-4 级标题、任意序号前缀（一、/1. 等）。
 * 为什么不用固定 ## ：历史档案里标题层级不统一，只认 ## 会整篇误报「缺章节」。
 */
function sectionBody(text, name) {
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,4})\s+(.+?)\s*$/);
    if (!h) continue;
    const title = h[2].replace(/^[一二三四五六七八九十百]+、\s*/, "").replace(/^\d+(\.\d+)*[.、]?\s*/, "").trim();
    if (!title.includes(name)) continue;
    const level = h[1].length;
    const buf = [];
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j].match(/^(#{1,4})\s+/);
      if (n && n[1].length <= level) break;
      buf.push(lines[j]);
    }
    return buf.join("\n");
  }
  return null;
}

function hasSection(text, name) { return sectionBody(text, name) !== null; }

/** 解析第一个表头包含所有关键词的 markdown 表，返回 [{列名: 值}] */
function table(text, mustHave) {
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const header = splitRow(lines[i]);
    if (!mustHave.every(k => header.some(h => h.includes(k)))) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      if (!lines[j].trim().startsWith("|")) break;
      const cells = splitRow(lines[j]);
      const row = {};
      header.forEach((h, k) => { row[h] = (cells[k] || "").trim(); });
      rows.push(row);
    }
    return { header, rows };
  }
  return null;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
}

const isEmptyCell = v => !v || /^<.*>$/.test(v) || v === "-" || v === "—";

// ---------- design_lint ----------

/**
 * 设计文档机械检查。mode: off | warn | block（block 时存在 blocker 级问题即 ok=false）。
 * 返回 findings 全部带 code，便于按码豁免或统计。
 */
async function designLint(reqId, opts = {}) {
  const mode = opts.mode || "warn";
  if (mode === "off") return { ok: true, mode, skipped: true, findings: [] };

  const findings = [];
  const add = (level, code, message, file = DOC.design, judge) =>
    findings.push({ level, code, file, message, ...(judge ? { judge } : {}) });

  // 1) 主链路禁止过程内容
  for (const name of Object.values(DOC)) {
    const text = await readDoc(reqId, name);
    if (!text) continue;
    const m = text.match(PROCESS_HEADINGS);
    if (m) add("blocker", "process-content", `主链路文档出现过程性章节「${m[0].replace(/^#+\s*/, "")}」：过程记录请移到 log/YYYY-MM-DD.md`, name);
  }

  const design = await readDoc(reqId, DOC.design);
  if (!design) return { ok: true, mode, findings, counts: { blocker: 0, major: 0, minor: 0 }, note: "尚无 03-design.md，跳过设计检查" };

  // 2) 七部分结构：全缺只报一条（老档案没按模板写，逐条刷 7 条没信息量）
  const missingSections = DESIGN_SECTIONS.filter(n => !hasSection(design, n));
  if (missingSections.length === DESIGN_SECTIONS.length) {
    add("blocker", "section-missing", "文档未按七部分结构组织（需求背景/业务流程/领域划分/实体设计/数据建模/落地实现/边界场景）");
  } else {
    for (const name of missingSections) add("blocker", "section-missing", `缺少「${name}」章节`);
  }

  // 3) 术语表 + 自造词
  const termText = sectionBody(design, "术语表") || sectionBody(design, "名词解释") || "";
  const defined = new Set((termText.match(/[\u4e00-\u9fa5]{2,}/g) || []).concat(termText.match(/[A-Za-z][A-Za-z0-9]+/g) || []));
  const cands = new Set();
  for (const m of design.matchAll(new RegExp(INVENTED_SUFFIX.source, "g"))) {
    const w = m[0];
    if (!COMMON_TERMS.has(w) && !defined.has(w)) cands.add(w);
  }
  if (!termText) add("major", "terms-missing", "缺少「术语表」：设计中的自造词必须在此给一句话解释，或改用 PRD 原词");
  else for (const w of [...cands].slice(0, 8)) {
    add("major", "term-undefined", `「${w}」未在术语表登记（要么加解释，要么改用 PRD 原词）`, DOC.design, {
      type: "bool",
      instructions: `判断「${w}」是行业/团队通用叫法，还是本文档自造的新词。自造词=读者需要额外解释才能懂。`,
      criteria: { true: "通用术语，读者不需要解释", false: "自造词，读者需要解释才能懂" },
    });
  }

  // 4) 调用链路完备性
  const link = table(design, ["上下游", "协议"]);
  if (!link) {
    add("blocker", "link-table-missing", "缺少「调用链路」表：上下游/协议/量级/超时/降级/幂等/事务边界/SLO 逐列填满");
  } else {
    for (const col of LINK_COLUMNS) {
      if (!link.header.some(h => h.includes(col))) add("blocker", "link-column-missing", `调用链路表缺少「${col}」列`);
    }
    link.rows.forEach((r, i) => {
      const empty = LINK_COLUMNS.filter(col => {
        const key = Object.keys(r).find(h => h.includes(col));
        return key && isEmptyCell(r[key]);
      });
      if (empty.length) add("major", "link-cell-empty", `调用链路第 ${i + 1} 行缺：${empty.join("、")}（不适用写「不涉及+理由」）`);
    });
  }

  // 5) 复用论证（反过度设计）：新增抽象必须有「为何不能复用」
  const implText = sectionBody(design, "落地实现") || "";
  const newAbstractions = [...new Set((implText.match(/\b[A-Z]\w*(Service|Manager|Facade|Helper|Handler)\b/g) || []))];
  const reuse = sectionBody(design, "复用论证") || "";
  if (newAbstractions.length && !reuse) {
    add("major", "reuse-missing", `新增抽象（${newAbstractions.slice(0, 4).join("、")}）缺少「复用论证」：逐个说明为何不能复用现有代码`);
  }

  // 6) 编号必须带人话名称（定义处）
  for (const line of design.split("\n")) {
    const h = line.match(/^###+\s+((?:AC|T|CHG|D|M|R)-\d+)\s*$/);
    if (h) add("major", "bare-id", `编号「${h[1]}」没有名称：写成「${h[1]} 一句话说明」`);
  }
  for (const name of [DOC.clarify, DOC.tasks]) {
    const text = await readDoc(reqId, name);
    if (!text) continue;
    for (const line of text.split("\n")) {
      const h = line.match(/^###+\s+((?:AC|T|CHG|D|M|R)-\d+)\s*$/);
      if (h) add("major", "bare-id", `编号「${h[1]}」没有名称：写成「${h[1]} 一句话说明」`, name);
    }
  }

  // 7) 精简：段落句数 / 列表项数 / 全文行数
  const prose = design.replace(/```[\s\S]*?```/g, ""); // 代码块不是正文
  const paragraphs = prose.split(/\n\s*\n/).filter(block => {
    const lines = block.split("\n").filter(l => l.trim());
    if (!lines.length) return false;
    if (/^\s*(#|\||[-*]\s|>)/.test(lines[0])) return false;          // 标题/表格/列表/引用
    const structured = lines.filter(l => /^\s*(\||[-*]\s|\d+[.)]\s)/.test(l)).length;
    return structured < lines.length * 0.5;                            // 表格列表为主的块跳过
  });
  for (const p of paragraphs) {
    const sentences = (p.match(/[。！？!?]/g) || []).length;
    if (sentences > LIMITS.paragraphSentences) {
      add("major", "verbose-paragraph", `一段 ${sentences} 句（上限 ${LIMITS.paragraphSentences}）：拆开或改成列表`, DOC.design, {
        type: "bool",
        instructions: "判断这段是否含可删的铺垫/重复表述（不是句子多就一定要拆）。",
        criteria: { true: "确有冗余，可删可拆", false: "每句都承载信息，保留" },
      });
      break;
    }
  }
  let bullets = 0;
  for (const line of design.split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) bullets += 1;
    else { if (bullets > LIMITS.listItems) { add("major", "verbose-list", `一组列表 ${bullets} 项（上限 ${LIMITS.listItems}）：分组或改成表格`); break; } bullets = 0; }
  }
  const lineCount = design.split("\n").length;
  if (lineCount > LIMITS.designLines) add("minor", "doc-too-long", `设计文档 ${lineCount} 行（参考上限 ${LIMITS.designLines}）：按模块拆分`);
  for (const w of FILLERS) if (design.includes(w)) { add("minor", "filler", `套话「${w}」：删掉，直接给结论`); break; }

  // 8) 日志：新增对外接口却没有日志说明
  if (/新增|改动/.test(implText) && /接口|Controller|Api/i.test(implText) && !/日志|log|traceId/i.test(design)) {
    add("major", "no-logging", "设计涉及新增/改动接口但未提日志与 traceId：关键路径日志与链路标识必须写进设计");
  }

  const bad = findings.filter(f => f.level === "blocker" || f.level === "major");
  const ok = mode === "block" ? !findings.some(f => f.level === "blocker") : true;
  return {
    ok, mode, findings,
    counts: {
      blocker: findings.filter(f => f.level === "blocker").length,
      major: findings.filter(f => f.level === "major").length,
      minor: findings.filter(f => f.level === "minor").length,
    },
    // 语义类判据交给 Jev（可选）：没配 Jev 就按上面的机械结论处理
    needsJudge: findings.filter(f => f.judge).map(f => ({ code: f.code, message: f.message, ...f.judge })),
    gate: mode === "warn" ? (bad.length ? `告警模式：${bad.length} 项待修，暂不拦截` : "无待修项") : undefined,
  };
}

// ---------- trace_matrix ----------

/** 读过程流水里的派发记录：派发 <角色>｜任务：<T-01 …> */
async function dispatchOf(reqId) {
  let files = [];
  try {
    files = (await pi.fs.list(`requirements/${reqId}/log`)).filter(e => !e.isDirectory).map(e => e.name);
  } catch { return []; }
  const out = [];
  for (const f of files) {
    let text;
    try { text = await pi.fs.readText(`requirements/${reqId}/log/${f}`); } catch { continue; }
    for (const m of text.matchAll(/派发\s+([^｜\n]+)｜任务：([^｜\n]+)/g)) {
      const tasks = (m[2].match(/T-\d+/g) || []);
      out.push({ role: m[1].trim(), task: m[2].trim(), tasks });
    }
  }
  return out;
}

async function evidenceOf(reqId) {
  try {
    const raw = await pi.fs.readText(`requirements/${reqId}/evidence.json`);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : (arr.entries || []);
  } catch { return []; }
}

/** AC → 任务 → 用例 → 证据 的覆盖矩阵 */
async function traceMatrix(reqId) {
  const clarify = (await readDoc(reqId, DOC.clarify)) || "";
  const tasksDoc = (await readDoc(reqId, DOC.tasks)) || "";
  const testDoc = (await readDoc(reqId, DOC.testPlan)) || "";

  // AC：### AC-01 名称  或  ### AC-01
  const acs = [];
  const lines = clarify.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/^###+\s*(AC-\d+)\s*(.*)$/);
    if (!m) return;
    let name = (m[2] || "").replace(/^[：:\s]+/, "").trim();
    // 名称常写在标题下一行，标题为空时往下找第一条非空文本
    if (!name) {
      for (let j = i + 1; j < lines.length && j < i + 4; j++) {
        const t = lines[j].trim();
        if (t && !t.startsWith("#") && !t.startsWith("<!--")) { name = t.slice(0, 30); break; }
      }
    }
    acs.push({ id: m[1], name });
  });

  const taskRows = (table(tasksDoc, ["任务编号", "任务"]) || { rows: [] }).rows
    .filter(r => !isEmptyCell(r["任务编号"]))
    .map(r => ({
      id: ((r["任务编号"] || "").match(/\bT-\d+\b/) || [r["任务编号"] || ""])[0],
      name: r["任务"] || "",
      covers: parseIds(r[findKey(r, "覆盖") || "covers"] || r["覆盖AC"] || ""),
      verify: r[findKey(r, "verify") || findKey(r, "验证") || ""] || "",
      done: /\[x\]/i.test(Object.values(r).join(" ")),
    }));

  const cases = [];
  for (const line of testDoc.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const id = (line.match(/\b(TC-\d+)\b/) || [])[1];
    if (!id) continue;
    cases.push({ id, verifies: parseIds(line) });
  }

  const evidence = await evidenceOf(reqId);
  const dispatches = await dispatchOf(reqId);
  const evByTask = new Map();
  for (const e of evidence) {
    const list = evByTask.get(e.task) || [];
    list.push(e);
    evByTask.set(e.task, list);
  }

  const rows = acs.map(ac => {
    const covTasks = taskRows.filter(t => t.covers.includes(ac.id));
    const covCases = cases.filter(c => c.verifies.includes(ac.id));
    const evOk = covTasks.some(t => (evByTask.get(t.id) || []).some(e => e.pass));
    return {
      ac: ac.id, name: ac.name || "(未命名)",
      tasks: covTasks.map(t => t.id),
      cases: covCases.map(c => c.id),
      evidence: evOk,
    };
  });

  const hasCoversColumn = /\|/.test(tasksDoc) && /覆盖\s*AC|覆盖AC/.test(tasksDoc);
  const gaps = {
    // 老档案没有「覆盖AC」列：只报一次「缺列」，不把每条 AC 都列成缺口
    tasksNoCoversColumn: hasCoversColumn || !tasksDoc ? [] : ["05-tasks.md"],
    acNoTask: hasCoversColumn ? rows.filter(r => !r.tasks.length).map(r => r.ac) : [],
    acNoCase: rows.filter(r => !r.cases.length).map(r => r.ac),
    acNoEvidence: rows.filter(r => !r.evidence && r.tasks.length).map(r => r.ac),
    taskNoVerify: taskRows.filter(t => !t.verify).map(t => t.id),
    taskNoEvidence: taskRows.filter(t => t.done && !(evByTask.get(t.id) || []).length).map(t => t.id),
    // 已勾选但查不到派发记录 → 大概率是父 Agent 自己动手写的（越权），要人看
    taskNoDispatch: taskRows
      .filter(t => t.done && !dispatches.some(d => d.tasks.includes(t.id)))
      .map(t => t.id),
  };
  return { reqId, acs: rows, tasks: taskRows.length, cases: cases.length, evidence: evidence.length, gaps, ok: !gaps.acNoTask.length };
}

function findKey(row, kw) { return Object.keys(row).find(k => k.toLowerCase().includes(kw.toLowerCase())); }

function parseIds(text) {
  return [...new Set(String(text || "").match(/\b(?:AC|TC)-\d+\b/g) || [])];
}

module.exports = { LIMITS, designLint, traceMatrix, evidenceOf, dispatchOf, readDoc, frontmatter, sectionBody, hasSection, table, DOC };
