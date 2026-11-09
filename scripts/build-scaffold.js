#!/usr/bin/env node
/**
 * 生成插件内嵌脚手架：把 .pi/commands + docs/ + requirements/README.md
 * 压成 gzip+base64 写进 packages/pi-workflow-gates/scaffold.generated.js。
 *
 * 为什么需要：`.piplug` 只打包插件目录下的文件。别人安装插件后，插件目录里没有
 * 仓库根的两级父目录，adopt_project 拿不到工作流源资产就无法接入新仓。
 * 内嵌后：插件自带一份脚手架，装到任何机器、任何路径都能工作。
 *
 * 产物是构建产物，已 gitignore：开发态没有这个文件时 main.js 会回退到读仓库目录。
 *
 * 用法：node scripts/build-scaffold.js [--check]
 *       --check 只校验产物是否与当前源一致（不一致退出码 1，供 CI / 提交前检查）
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "packages", "pi-workflow-gates", "scaffold.generated.js");
const SOURCES = [".pi/commands", "docs", "requirements/README.md"];

function walk(abs, rel, acc) {
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (/\.(md|markdown|txt)$/i.test(abs)) acc[rel] = fs.readFileSync(abs, "utf8");
    return acc;
  }
  for (const name of fs.readdirSync(abs).sort()) {
    if (name === ".git" || name === "node_modules" || name.startsWith(".")) continue; // 跳过点文件：脚手架不需要
    walk(path.join(abs, name), rel ? `${rel}/${name}` : name, acc);
  }
  return acc;
}

function build() {
  const map = {};
  for (const src of SOURCES) {
    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) throw new Error(`缺少脚手架源：${src}`);
    walk(abs, path.posix.dirname(src) === "." ? path.posix.basename(src) : src.split(path.sep).join("/"), map);
  }
  const json = JSON.stringify(map);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 }).toString("base64");
  const files = Object.keys(map).sort();
  return {
    content: `/**
 * 自动生成，请勿手改 —— 由 scripts/build-scaffold.js 从 .pi/commands + docs/ + requirements/README.md 生成。
 * 用途：插件自带工作流脚手架，安装到任意机器后 adopt_project 仍能接入新仓。
 * 文件清单：${files.length} 个（gzip+base64，运行时解压）
 */
module.exports = {
  encoding: "gzip+base64",
  fileCount: ${files.length},
  files: ${JSON.stringify(files)},
  data: "${gz}",
};
`,
    fileCount: files.length,
    bytes: gz.length,
  };
}

const built = build();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== built.content) {
    console.error("✘ scaffold.generated.js 已过期，请重新执行：node scripts/build-scaffold.js");
    process.exit(1);
  }
  console.log(`✔ 内嵌脚手架是最新的（${built.fileCount} 个文件）`);
} else {
  fs.writeFileSync(OUT, built.content);
  console.log(`✓ 已生成 ${path.relative(ROOT, OUT)}：${built.fileCount} 个文件，base64 ${(built.bytes / 1024).toFixed(1)} KB`);
}
