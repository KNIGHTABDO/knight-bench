import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "results", "gpt-5.5-results");
const outputDir = path.join(root, "judging", "design-review");

const source = (task) => fs.readFileSync(path.join(sourceDir, `task-${task}.md`), "utf8");
const htmlBlock = (text) => text.match(/```html\s*\r?\n([\s\S]*?)\r?\n```/i)?.[1] ?? text;
const escapeHtml = (text) => text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);

fs.writeFileSync(path.join(outputDir, "E-4.1.html"), source("4.1"), "utf8");
fs.writeFileSync(
  path.join(outputDir, "E-4.2.html"),
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>E-4.2 component packet</title><style>body{margin:0;background:#111;color:#eee;font-family:system-ui;padding:24px}pre{white-space:pre-wrap;direction:ltr;text-align:left;background:#181818;padding:16px;border-radius:8px;overflow:auto}</style></head><body><h1>E-4.2 Component Source</h1><pre>${escapeHtml(source("4.2"))}</pre></body></html>`,
  "utf8",
);
fs.writeFileSync(path.join(outputDir, "E-4.3.html"), htmlBlock(source("4.3")), "utf8");
