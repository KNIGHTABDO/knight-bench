import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { builtinModules } from "node:module";

const root = process.cwd();
const judging = path.join(root, "judging");
const evidenceRoot = path.join(judging, "evidence");
const scratchRoot = path.join(judging, "scratch");
const designRoot = path.join(judging, "design-review");

const models = {
  gemini: "gemini-3.5-flash-results",
  grok: "grok-4.5-results",
  sonnet: "sonnet-5-results",
};

const displayName = {
  gemini: "Gemini 3.5 Flash",
  grok: "Grok 4.5",
  sonnet: "Claude Sonnet 5",
};

const taskIds = [
  "1.1", "1.2", "1.3",
  "2.1", "2.2", "2.3",
  "3.1", "3.2", "3.3",
  "4.1", "4.2", "4.3",
  "5.1", "5.2", "5.3",
  "6.1", "6.2", "6.3",
  "7.1", "7.2", "7.3",
  "8.1", "8.2",
  "9.1", "9.2", "9.3",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readTask(model, task) {
  const p = path.join(root, "results", models[model], `task-${task}.md`);
  if (!fs.existsSync(p)) return { path: p, text: "", missing: true };
  return { path: p, text: fs.readFileSync(p, "utf8"), missing: false };
}

function writeEvidence(model, task, text) {
  const dir = path.join(evidenceRoot, model);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${task}-checks.md`), text, "utf8");
}

function fenceBlocks(md) {
  const blocks = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) {
    const before = md.slice(Math.max(0, m.index - 450), m.index);
    blocks.push({
      info: (m[1] || "").trim(),
      code: m[2].replace(/\r\n/g, "\n"),
      index: m.index,
      before,
    });
  }
  return blocks;
}

function inferPath(block, fallbackBase = "block") {
  const candidates = [];
  const info = block.info.replace(/^tsx?|^jsx?|^javascript|^python|^html|^css|^json|^sql|^bash/i, "").trim();
  candidates.push(info);
  const before = block.before;
  const backticks = [...before.matchAll(/`([^`\n]+\.(?:tsx?|jsx?|py|html|css|json|mjs|cjs))`/gi)].map(m => m[1]);
  candidates.push(...backticks.reverse());
  const headings = [...before.matchAll(/(?:^|\n)\s{0,3}#{1,6}\s+([^\n]+?\.(?:tsx?|jsx?|py|html|css|json|mjs|cjs))\s*$/gi)].map(m => m[1].trim());
  candidates.push(...headings.reverse());
  const linePaths = [...before.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?([A-Za-z0-9_@./\\[\]-]+\.(?:tsx?|jsx?|py|html|css|json|mjs|cjs))\s*(?:[:—-]|$)/g)].map(m => m[1]);
  candidates.push(...linePaths.reverse());
  for (const cRaw of candidates) {
    if (!cRaw) continue;
    let c = cRaw.trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
    c = c.replace(/^\.?\//, "");
    if (/^[A-Za-z]:/.test(c)) c = path.basename(c);
    if (/^[A-Za-z0-9_@./\[\]-]+\.(tsx?|jsx?|py|html|css|json|mjs|cjs)$/i.test(c)) return c;
  }
  const ext =
    /tsx/i.test(block.info) ? "tsx" :
    /typescript|ts\b/i.test(block.info) ? "ts" :
    /jsx/i.test(block.info) ? "jsx" :
    /javascript|js\b/i.test(block.info) ? "js" :
    /python|py\b/i.test(block.info) ? "py" :
    /html/i.test(block.info) ? "html" :
    /json/i.test(block.info) ? "json" :
    "txt";
  return `${fallbackBase}.${ext}`;
}

function safeWriteFile(baseDir, rel, content) {
  const clean = rel.replace(/^[/\\]+/, "").replace(/:/g, "");
  const target = path.join(baseDir, clean);
  if (!path.resolve(target).startsWith(path.resolve(baseDir))) {
    throw new Error(`unsafe path ${rel}`);
  }
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content, "utf8");
  return target;
}

function command(cmd, args, cwd, timeout = 30000) {
  const res = spawnSync(cmd, args, {
    cwd,
    timeout,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    cmd: [cmd, ...args].join(" "),
    cwd,
    status: res.status,
    signal: res.signal,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error ? String(res.error) : "",
  };
}

function mdCommandResult(r) {
  return [
    `Command: \`${r.cmd}\``,
    `CWD: \`${r.cwd}\``,
    `Exit: ${r.status}${r.signal ? ` signal=${r.signal}` : ""}${r.error ? ` error=${r.error}` : ""}`,
    "",
    "STDOUT:",
    "```text",
    trimBig(r.stdout),
    "```",
    "STDERR:",
    "```text",
    trimBig(r.stderr),
    "```",
  ].join("\n");
}

function trimBig(s, max = 12000) {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n... [truncated ${s.length - max} chars]`;
}

function bulletCheck(name, pass, evidence = "") {
  return `- ${pass ? "[PASS]" : "[FAIL]"} ${name}${evidence ? ` — ${evidence}` : ""}`;
}

function stripFences(md) {
  const blocks = fenceBlocks(md);
  if (blocks.length === 1 && blocks[0].index < 20 && blocks[0].index + blocks[0].code.length + blocks[0].info.length + 8 >= md.trim().length) {
    return blocks[0].code.trim();
  }
  return md.trim();
}

function wordTokens(s) {
  return [...s.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)].map(m => m[0]);
}

function sentenceSplit(s) {
  return s
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map(x => x.trim())
    .filter(Boolean) || [];
}

function normalizeSpaces(s) {
  return s.replace(/\s+/g, " ").trim();
}

function isFrenchish(s) {
  const lower = s.toLowerCase();
  const hits = [" le ", " la ", " les ", " des ", " une ", " avec ", " pour ", " selon ", " chez ", " doit ", " est ", " pas "]
    .filter(w => ` ${lower} `.includes(w)).length;
  return hits >= 3;
}

function extractAnnouncement81(md) {
  const noLead = md.replace(/^#.*\n+/g, "").trim();
  const markers = [
    /\n\s*\|?\s*constraint\s*#?\s*\|/i,
    /\n\s*##?\s*compliance/i,
    /\n\s*tableau/i,
    /\n\s*constraint\s*#\s*→/i,
    /\n\s*\|?\s*n[°o]?\s*\|/i,
  ];
  let cut = noLead.length;
  for (const re of markers) {
    const m = re.exec(noLead);
    if (m && m.index < cut) cut = m.index;
  }
  return noLead.slice(0, cut).trim();
}

function parseComplianceClaims(md) {
  const lines = md.split(/\r?\n/);
  const claims = new Map();
  for (const line of lines) {
    const m = line.match(/^\s*\|?\s*(\d{1,2})\s*\|(.+)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 50) continue;
    const rest = m[2].toLowerCase();
    const claimedPass = /✅|pass|passed|met|satisf|oui|yes|respect|conforme|ok\b|correct/.test(rest) && !/\b(no|non|fail|violat|not met|missing|incorrect)\b/.test(rest);
    const claimedFail = /❌|fail|violat|missing|non\b|not met|incorrect/.test(rest);
    claims.set(n, { line, claimedPass, claimedFail });
  }
  return claims;
}

function checkEightOne(md) {
  const ann = extractAnnouncement81(md);
  const paragraphs = ann.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const sentences = paragraphs.flatMap(p => sentenceSplit(p));
  const words = wordTokens(ann);
  const lower = ann.toLowerCase();
  const countWord = (w, flags = "gi") => (ann.match(new RegExp(`\\b${w}\\b`, flags)) || []).length;
  const cityNames = ["Casablanca", "Marrakech", "Rabat", "Fez", "Fes", "Tangier", "Cairo", "Dubai", "Doha", "Riyadh", "Jeddah", "Istanbul", "Tokyo", "Kyoto", "Seoul", "Bangkok", "Mumbai", "Delhi", "Lagos", "Nairobi", "Dakar", "Tunis", "Algiers", "Beirut", "Amman", "Marrakesh", "Mexico City", "New York", "Toronto", "Montreal", "Sydney", "São Paulo", "Sao Paulo", "Buenos Aires", "Lima", "Bogota", "Bogotá"];
  const cityHits = [];
  for (const c of cityNames) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const n = (ann.match(re) || []).length;
    for (let i = 0; i < n; i++) cityHits.push(c);
  }
  const italicFrench = [...ann.matchAll(/\*([\p{L}]+)\*/gu)].map(m => m[1]);
  const starts = sentences.map(s => (wordTokens(s)[0] || "").toLowerCase());
  const repeatedStart = starts.some((x, i) => i > 0 && x && x === starts[i - 1]);
  const repeat3 = sentences.filter(s => {
    const counts = new Map();
    for (const w of wordTokens(s).map(x => x.toLowerCase())) counts.set(w, (counts.get(w) || 0) + 1);
    return [...counts.values()].some(n => n >= 3);
  });
  const writtenNumbers = ["zero","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety","hundred"];
  const writtenHits = [];
  for (const n of writtenNumbers) {
    const re = new RegExp(`\\b${n}\\b`, "gi");
    const matches = ann.match(re) || [];
    for (const _ of matches) writtenHits.push(n.toLowerCase());
  }
  const zWords = words.filter(w => /z/i.test(w));
  const longWords = words.filter(w => [...w].length >= 12);
  const paren = [...ann.matchAll(/\(([^()]*)\)/g)].map(m => m[1]);
  const contractions = ann.match(/\b\p{L}+['’]\p{L}+\b/gu) || [];
  const ingCount = (lower.match(/ing/g) || []).length;
  const finalWord = (words[words.length - 1] || "").replace(/[^\p{L}\p{N}]+/gu, "");
  const noOxford = !/,\s+\b(?:and|or)\b/i.test(ann);
  const checks = new Map();
  const add = (n, name, pass, detail) => checks.set(n, { name, pass, detail });
  add(1, "Total length 380-420 words", words.length >= 380 && words.length <= 420, `${words.length} words`);
  add(2, "Exactly 7 paragraphs", paragraphs.length === 7, `${paragraphs.length}`);
  add(3, "Paragraph 1 exactly 2 sentences", sentenceSplit(paragraphs[0] || "").length === 2, `${sentenceSplit(paragraphs[0] || "").length}`);
  add(4, "Rihla exactly 5 times", countWord("Rihla", "g") === 5, `${countWord("Rihla", "g")}`);
  add(5, "No journey", countWord("journey") === 0, `${countWord("journey")}`);
  add(6, "No seamless", countWord("seamless") === 0, `${countWord("seamless")}`);
  add(7, "No em dash", !/[—]/.test(ann), `${(ann.match(/—/g) || []).length}`);
  add(8, "No exclamation marks", !ann.includes("!"), `${(ann.match(/!/g) || []).length}`);
  add(9, "Exactly one question mark in paragraph 4", (ann.match(/\?/g) || []).length === 1 && ((paragraphs[3] || "").match(/\?/g) || []).length === 1, `all=${(ann.match(/\?/g) || []).length}, p4=${((paragraphs[3] || "").match(/\?/g) || []).length}`);
  add(10, "Paragraph 2 begins Planning", /^Planning\b/.test(paragraphs[1] || ""), `${(paragraphs[1] || "").slice(0, 40)}`);
  add(11, "Paragraph 7 exactly one sentence", sentenceSplit(paragraphs[6] || "").length === 1, `${sentenceSplit(paragraphs[6] || "").length}`);
  add(12, "Numeral 14 exactly once", (ann.match(/\b14\b/g) || []).length === 1, `${(ann.match(/\b14\b/g) || []).length}`);
  add(13, "Exactly 3 italicized French words", italicFrench.length === 3, italicFrench.join(", "));
  add(14, "Italicized boussole included", italicFrench.includes("boussole"), italicFrench.join(", "));
  add(15, "No sentence >24 words", sentences.every(s => wordTokens(s).length <= 24), `max=${Math.max(0, ...sentences.map(s => wordTokens(s).length))}`);
  add(16, "At least one 4-word sentence", sentences.some(s => wordTokens(s).length === 4), `${sentences.map(s => wordTokens(s).length).join(",")}`);
  const allCapsPhrases = [...ann.matchAll(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/g)].map(m => m[0]);
  add(17, "Two-word all-caps slogan exactly once", allCapsPhrases.filter(p => p.split(/\s+/).length === 2).length === 1, allCapsPhrases.join("; "));
  add(18, "Slogan lacks letter e", allCapsPhrases.filter(p => p.split(/\s+/).length === 2).length === 1 && !/e/i.test(allCapsPhrases.find(p => p.split(/\s+/).length === 2) || ""), allCapsPhrases.join("; "));
  add(19, "Paragraph 5 exactly 40 words", wordTokens(paragraphs[4] || "").length === 40, `${wordTokens(paragraphs[4] || "").length}`);
  add(20, "No consecutive same sentence start", !repeatedStart, starts.join(", "));
  add(21, "offline first exactly once", (lower.match(/\boffline first\b/g) || []).length === 1, `${(lower.match(/\boffline first\b/g) || []).length}`);
  add(22, "Exactly 3 city names", cityHits.length === 3, cityHits.join(", "));
  add(23, "Casablanca included", cityHits.includes("Casablanca"), cityHits.join(", "));
  add(24, "No city repeated", new Set(cityHits).size === cityHits.length, cityHits.join(", "));
  add(25, "Exactly one semicolon", (ann.match(/;/g) || []).length === 1, `${(ann.match(/;/g) || []).length}`);
  add(26, "No colons", (ann.match(/:/g) || []).length === 0, `${(ann.match(/:/g) || []).length}`);
  add(27, "you at least 6", countWord("you") >= 6, `${countWord("you")}`);
  add(28, "we at most 2", countWord("we") <= 2, `${countWord("we")}`);
  add(29, "Only one question mark total", (ann.match(/\?/g) || []).length === 1, `${(ann.match(/\?/g) || []).length}`);
  add(30, "Paragraph 3 contains map twice", ((paragraphs[2] || "").match(/\bmap\b/gi) || []).length === 2, `${((paragraphs[2] || "").match(/\bmap\b/gi) || []).length}`);
  add(31, "No word repeated 3+ in a sentence", repeat3.length === 0, repeat3.map(s => normalizeSpaces(s)).join(" | "));
  add(32, "Exactly one written-out number and not one", writtenHits.length === 1 && writtenHits[0] !== "one", writtenHits.join(", "));
  add(33, "Written-out number not one", !writtenHits.includes("one"), writtenHits.join(", "));
  add(34, "Final word begins", finalWord.toLowerCase() === "begins", finalWord);
  add(35, "No paragraph begins The", paragraphs.every(p => !/^The\b/.test(p)), paragraphs.map(p => (wordTokens(p)[0] || "")).join(", "));
  add(36, "Exactly 2 z-words", zWords.length === 2, zWords.join(", "));
  add(37, "Passive voice heuristic none", !/\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/i.test(ann), "heuristic");
  add(38, "Weather metaphor heuristic present", /\b(weather|storm|rain|cloud|wind|sun|forecast|sky|climate|breeze|tempest|fog)\b/i.test(ann), "heuristic");
  add(39, "No bullets/lists/headers", !/(^|\n)\s*(?:[-*•]|\d+[.)]|#{1,6}\s+)/.test(ann), "regex");
  add(40, "ing at most 8", ingCount <= 8, `${ingCount}`);
  add(41, "Morocco exactly once", countWord("Morocco", "g") === 1, `${countWord("Morocco", "g")}`);
  const p6Words = wordTokens(paragraphs[5] || "");
  add(42, "Paragraph 6 begins and ends same word", p6Words.length > 0 && p6Words[0].toLowerCase() === p6Words[p6Words.length - 1].toLowerCase(), `${p6Words[0] || ""}/${p6Words[p6Words.length - 1] || ""}`);
  add(43, "No sentence begins And/But", !sentences.some(s => /^(And|But)\b/.test(s)), starts.join(", "));
  add(44, "Exactly one word 12+ letters", longWords.length === 1, longWords.join(", "));
  add(45, "No contractions", contractions.length === 0, contractions.join(", "));
  add(46, "Every paragraph contains r", paragraphs.every(p => /r/i.test(p)), paragraphs.map(p => /r/i.test(p) ? "r" : "NO").join(", "));
  add(47, "Parenthetical exactly once", paren.length === 1, `${paren.length}: ${paren.join(" | ")}`);
  add(48, "Parenthetical 5 words or fewer", paren.length === 1 && wordTokens(paren[0]).length <= 5, paren.map(p => `${p} (${wordTokens(p).length})`).join(" | "));
  add(49, "No Oxford comma heuristic", noOxford, "comma + and/or heuristic");
  add(50, "No AI / artificial intelligence / machine learning", !/\b(?:AI|artificial intelligence|machine learning)\b/i.test(ann), `${(ann.match(/\b(?:AI|artificial intelligence|machine learning)\b/gi) || []).join(", ")}`);

  const claims = parseComplianceClaims(md);
  const lies = [];
  for (const [n, c] of checks) {
    const claim = claims.get(n);
    if (claim?.claimedPass && !c.pass) lies.push({ n, actual: c, claim: claim.line });
  }
  return { ann, paragraphs, checks, lies };
}

function checkNineOne(md) {
  const text = stripFences(md);
  const words = wordTokens(text);
  const bullets = /(^|\n)\s*(?:[-*•]|\d+[.)])\s+/.test(text);
  const terms = ["SSR", "SSG", "ISR", "streaming SSR"];
  return {
    text, words: words.length, bullets,
    terms: terms.map(t => ({ term: t, present: new RegExp(`\\b${t.replace(/\s+/g, "\\s+")}\\b`, "i").test(text) })),
  };
}

function checkNineThree(md) {
  const text = stripFences(md);
  const words = wordTokens(text);
  return {
    text, words: words.length,
    has30: /\b30\b/.test(text),
    sixMonths: /(?:six mois|6 mois)/i.test(text),
    apixaban: /apixaban/i.test(text),
    rivaroxaban: /rivaroxaban/i.test(text),
    french: isFrenchish(text),
  };
}

function extractJSFunction(md) {
  const blocks = fenceBlocks(md).filter(b => /javascript|js|typescript|ts|tsx|jsx|^\s*$/i.test(b.info));
  if (blocks.length) return blocks.sort((a, b) => b.code.length - a.code.length)[0].code.trim();
  return md.trim();
}

function runDebounceTest(model, md) {
  const dir = path.join(scratchRoot, model, "9.2");
  ensureDir(dir);
  const code = extractJSFunction(md);
  const file = path.join(dir, "submission.js");
  fs.writeFileSync(file, code, "utf8");
  const test = `
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const code = fs.readFileSync("submission.js", "utf8");
const ctx = { module: { exports: {} }, exports: {}, setTimeout, clearTimeout, console };
vm.createContext(ctx);
vm.runInContext(code + "\\n;globalThis.__fn = typeof debounceWithFlush === 'function' ? debounceWithFlush : module.exports;", ctx);
const debounceWithFlush = ctx.__fn;
assert.equal(typeof debounceWithFlush, "function");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let calls = [];
  const obj = { tag: "ctx" };
  function fn(...args) { calls.push({ thisValue: this, args }); return args.join("-"); }
  const d = debounceWithFlush(fn, 35);
  d.call(obj, "a", 1);
  d.call(obj, "b", 2);
  await sleep(60);
  assert.equal(calls.length, 1, "basic debounce should call once");
  assert.equal(calls[0].thisValue, obj, "this preserved");
  assert.deepEqual(calls[0].args, ["b", 2], "last args preserved");
  d.flush();
  assert.equal(calls.length, 1, "flush with nothing pending is no-op");
  d.call(obj, "c", 3);
  d.flush();
  assert.equal(calls.length, 2, "pending flush invokes immediately");
  assert.deepEqual(calls[1].args, ["c", 3]);
  await sleep(60);
  assert.equal(calls.length, 2, "flush cleared timer");
  d.call(obj, "d", 4);
  d.cancel();
  await sleep(60);
  assert.equal(calls.length, 2, "cancel stops pending");
  d.call(obj, "e", 5);
  await sleep(60);
  assert.equal(calls.length, 3, "call after cancel works");
  assert.deepEqual(calls[2].args, ["e", 5]);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
`;
  fs.writeFileSync(path.join(dir, "test.cjs"), test, "utf8");
  const res = command("node", ["test.cjs"], dir, 10000);
  const lineCount = code.split(/\r?\n/).filter(l => l.trim().length).length;
  const proseOutside = fenceBlocks(md).length ? md.replace(/```[\s\S]*?```/g, "").trim() : "";
  return { dir, code, lineCount, proseOutside, result: res };
}

function extractAndSaveBlocks(model, task) {
  const { text } = readTask(model, task);
  const dir = path.join(scratchRoot, model, task);
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const blocks = fenceBlocks(text);
  const saved = [];
  let i = 0;
  for (const b of blocks) {
    i += 1;
    const info = b.info.toLowerCase();
    if (/bash|shell|sql|text|txt|diff/.test(info)) continue;
    if (!b.code.trim()) continue;
    const rel = inferPath(b, `block-${String(i).padStart(2, "0")}`);
    const target = safeWriteFile(dir, rel, b.code);
    saved.push({ ...b, rel, target });
  }
  return { dir, blocks, saved, text };
}

function writeTsScaffold(dir, files = null) {
  safeWriteFile(dir, "global.d.ts", `
declare namespace JSX { interface IntrinsicAttributes { key?: any; } interface IntrinsicElements { [elemName: string]: any; } }
declare namespace React { type ReactNode = any; type CSSProperties = any; type Ref<T = any> = any; type RefObject<T = any> = any; type MutableRefObject<T = any> = any; type FC<P = any> = (props: P) => any; }
declare namespace NodeJS { type Timeout = any; }
declare const process: any;
declare module "react" {
  export function useState<T = any>(initial?: T | (() => T)): [T, any];
  export function useEffect(effect: any, deps?: any[]): any;
  export function useMemo<T = any>(factory: () => T, deps?: any[]): T;
  export function useRef<T = any>(initial?: T): any;
  export function useCallback<T = any>(cb: T, deps?: any[]): T;
  export function forwardRef<T = any, P = any>(render: any): any;
  export type RefObject<T = any> = any;
  export type MutableRefObject<T = any> = any;
  export type ReactNode = any;
  export type CSSProperties = any;
  export const Fragment: any;
  const React: any; export default React;
}
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "next/link" { const Link: any; export default Link; }
declare module "next/image" { const Image: any; export default Image; }
declare module "next/navigation" { export const useParams: any; export const useRouter: any; }
declare module "better-sqlite3" { const Database: any; export default Database; }
declare module "path" { const path: any; export default path; export const join: any; export const resolve: any; }
declare module "hls.js" { const Hls: any; export default Hls; export const Events: any; export const ErrorTypes: any; export const ErrorDetails: any; }
declare module "*.css" { const v: any; export default v; }
`);
  const config = {
    compilerOptions: {
      target: "ES2021",
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      strict: false,
      noEmit: true,
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      baseUrl: ".",
      paths: { "@/*": ["./*"] },
      lib: ["ES2021", "DOM", "DOM.Iterable"]
    },
    exclude: ["node_modules"]
  };
  if (files && files.length) {
    config.files = [...new Set(["global.d.ts", ...files.map(f => f.replace(/\\/g, "/"))])];
  } else {
    config.include = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "global.d.ts"];
  }
  safeWriteFile(dir, "tsconfig.json", JSON.stringify(config, null, 2));
}

function stubOriginalNextTree(dir) {
  const stubs = {
    "app/layout.tsx": `import "./globals.css";\nexport default function RootLayout({ children }: { children: any }) { return <html><body>{children}</body></html>; }\n`,
    "app/page.tsx": `import { getTitles } from "../lib/db";\nexport default async function Page(){ const titles = await getTitles(); return <main>{JSON.stringify(titles)}</main>; }\n`,
    "app/watch/[id]/page.tsx": `"use client";\nexport default function WatchPage(){ return <div />; }\n`,
    "components/Player.tsx": `"use client";\nexport default function Player(props: { src: string; subtitles?: any; onProgress?: (p: number) => void }){ return <video src={props.src} />; }\n`,
    "components/ProfileSwitcher.tsx": `"use client";\nexport default function ProfileSwitcher(){ return <div />; }\n`,
    "lib/db.ts": `export type Title = { id: string; title?: string; name?: string; poster?: string; image?: string; src?: string; duration?: number };\nexport async function getTitles(): Promise<Title[]> { return []; }\nexport async function getTitle(id: string): Promise<Title | null> { return { id }; }\n`,
    "lib/profiles.ts": `export type Profile = { id: string; name: string; avatar?: string };\nexport function getProfiles(): Profile[] { return []; }\nexport function setActiveProfile(id: string): void {}\nexport function getActiveProfile(): Profile | null { return null; }\n`,
    "hooks/usePlayer.ts": `export function usePlayer(){ return { progress: 0, seek() {}, play() {}, pause() {} }; }\n`,
    "app/globals.css": ``,
  };
  for (const [rel, content] of Object.entries(stubs)) {
    const target = path.join(dir, rel);
    if (!fs.existsSync(target)) safeWriteFile(dir, rel, content);
  }
}

function collectImportsFromCode(code) {
  const out = [];
  for (const m of code.matchAll(/import\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of code.matchAll(/export\s+[^'"]*?\s+from\s+["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

function checkImportRefs(saved, task) {
  const given = new Set([
    "app/layout.tsx", "app/page.tsx", "app/watch/[id]/page.tsx",
    "components/Player.tsx", "components/ProfileSwitcher.tsx",
    "lib/db.ts", "lib/profiles.ts", "hooks/usePlayer.ts", "app/globals.css",
  ]);
  const declared = new Set([...given, ...saved.map(s => s.rel.replace(/\\/g, "/"))]);
  const allowedPackages = new Set(["react", "react-dom", "next", "next/link", "next/image", "next/navigation", "better-sqlite3"]);
  const builtins = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);
  const bad = [];
  const deps = new Set();
  for (const s of saved) {
    if (!/\.(tsx?|jsx?)$/i.test(s.rel)) continue;
    const imports = collectImportsFromCode(s.code);
    for (const imp of imports) {
      if (imp.startsWith(".")) {
        const base = path.posix.dirname(s.rel.replace(/\\/g, "/"));
        const raw = path.posix.normalize(path.posix.join(base, imp));
        const variants = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.jsx`, `${raw}/index.ts`, `${raw}/index.tsx`];
        if (!variants.some(v => declared.has(v))) bad.push(`${s.rel}: ${imp} -> ${raw}`);
      } else if (imp.startsWith("@/")) {
        const raw = imp.slice(2);
        const variants = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.jsx`, `${raw}/index.ts`, `${raw}/index.tsx`];
        if (!variants.some(v => declared.has(v))) bad.push(`${s.rel}: ${imp} -> ${raw}`);
      } else {
        const pkg = imp.split("/")[0].startsWith("@") ? imp.split("/").slice(0, 2).join("/") : imp.split("/")[0];
        deps.add(imp);
        if (!builtins.has(imp) && ![...allowedPackages].some(a => imp === a || imp.startsWith(`${a}/`))) bad.push(`${s.rel}: external package ${imp}`);
      }
    }
  }
  return { bad, deps: [...deps] };
}

function checkTask11(model) {
  const { dir, saved, text } = extractAndSaveBlocks(model, "1.1");
  stubOriginalNextTree(dir);
  const sourceFiles = [
    ...new Set([
      ...saved.filter(s => /\.(tsx?|jsx?)$/i.test(s.rel)).map(s => s.rel),
      "app/layout.tsx", "app/page.tsx", "app/watch/[id]/page.tsx",
      "components/Player.tsx", "components/ProfileSwitcher.tsx",
      "lib/db.ts", "lib/profiles.ts", "hooks/usePlayer.ts",
    ])
  ];
  writeTsScaffold(dir, sourceFiles);
  const firstFence = fenceBlocks(text)[0]?.index ?? Infinity;
  const planIdx = text.search(/(^|\n)#{0,3}\s*PLAN\b/i);
  const importCheck = checkImportRefs(saved, "1.1");
  const tsc = command("npx.cmd", ["tsc", "--noEmit", "--pretty", "false"], dir, 60000);
  const planText = firstFence === Infinity ? text : text.slice(0, firstFence);
  const plannedFiles = [];
  let inNotModifiedBlock = false;
  for (const line of planText.split(/\r?\n/)) {
    if (/not modified|intentionally not|files intentionally|not touched/i.test(line)) {
      inNotModifiedBlock = true;
      continue;
    }
    if (inNotModifiedBlock && /^\s*(?:---|##|###|\([bc]\)|\*\*\d+\.|\d+\.)/i.test(line)) inNotModifiedBlock = false;
    if (inNotModifiedBlock) continue;
    if (/no changes?|assumed to|would need|if in reality/i.test(line)) continue;
    const m = line.match(/(?:^|\s)`?([A-Za-z0-9_@./\\[\]-]+\.(?:tsx?|jsx?|py|html|css|json|mjs|cjs))`?/);
    if (m && !/^(?:Next|React|Node)\.js$/i.test(m[1])) plannedFiles.push(m[1].replace(/\\/g, "/"));
  }
  const fileBlocks = new Set(saved.map(s => s.rel.replace(/\\/g, "/")));
  const missingPlanned = [...new Set(plannedFiles)].filter(p => /\.(tsx?|jsx?|css|json)$/i.test(p) && !fileBlocks.has(p));
  const localStorageProgress = saved.filter(s => /progress|watch|continue/i.test(s.rel)).flatMap(s => (s.code.match(/localStorage/g) || []).map(() => s.rel));
  const checks = [
    bulletCheck("PLAN before first code block", planIdx >= 0 && planIdx < firstFence, `planIdx=${planIdx}, firstFence=${firstFence}`),
    bulletCheck("Zero localStorage in new progress-storage code", localStorageProgress.length === 0, localStorageProgress.join(", ") || "none"),
    bulletCheck("Imports reference given/new files or allowed packages", importCheck.bad.length === 0, importCheck.bad.join("; ") || "none"),
    bulletCheck("No package.json changes / no new package imports", !/package\.json/i.test(text) && importCheck.bad.every(x => !x.includes("external package")), `deps=${importCheck.deps.join(", ") || "none"}`),
    bulletCheck("Every declared modified file appears as fenced block", missingPlanned.length === 0, missingPlanned.join(", ") || "none"),
    bulletCheck("TypeScript compiles in scaffold", tsc.status === 0),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 1.1`, "", `Scratch: \`${dir}\``, "", ...checks, "", "Saved code blocks:", ...saved.map(s => `- ${s.rel}`), "", mdCommandResult(tsc)].join("\n");
}

const originalJsxReturn = `<div className="dashboard dark"><div className="stat viewers">{viewers}</div><div className="stat bitrate">{bitrate}kbps</div><div className={\`stat health \${health}\`}>{health}</div><ul className="log">{log.map((l,i)=><likey={i}>{l}</li>)}</ul></div>`;

function normalizeJsx(s) {
  return s.replace(/\s+/g, "").replace(/{" "}/g, "").replace(/,\s+/g, ",");
}

function checkTask13(model) {
  const { dir, saved, text } = extractAndSaveBlocks(model, "1.3");
  const codeBlock = saved.find(s => /LiveDashboard/.test(s.code)) || saved[0];
  const code = codeBlock?.code || "";
  if (!codeBlock) safeWriteFile(dir, "LiveDashboard.jsx", code);
  writeTsScaffold(dir, [codeBlock?.rel || "LiveDashboard.jsx"]);
  const lineCount = code.replace(/\s+$/g, "").split(/\r?\n/).length;
  const lineComment = code.match(/\/\/\s*LINES:\s*(\d+)/)?.[1];
  const setIntervals = (code.match(/\bsetInterval\b/g) || []).length;
  const signature = /function\s+LiveDashboard\s*\(\s*\{\s*streamId\s*,\s*refreshMs\s*=\s*5000\s*,\s*onError\s*\}\s*\)/.test(code);
  const hasAbort = /AbortController|AbortSignal|abort\(/.test(code);
  const returnMatch = code.match(/return\s*\(([\s\S]*?)\);\s*\n?\s*\}/);
  const normalized = returnMatch ? normalizeJsx(returnMatch[1]) : "";
  const domIdentical = normalized.includes(normalizeJsx(originalJsxReturn).slice(0, 70)) &&
    /dashboard dark/.test(code) && /stat viewers/.test(code) && /stat bitrate/.test(code) && /stat health/.test(code) && /className="log"/.test(code);
  const auditAll = [...Array(8)].every((_, i) => new RegExp(`(^|\\D)${i + 1}(\\D|$)`).test(text.slice(text.search(/audit|constraint/i))));
  const tsc = command("npx.cmd", ["tsc", "--noEmit", "--pretty", "false"], dir, 60000);
  const checks = [
    bulletCheck("Exactly one setInterval", setIntervals === 1, `${setIntervals}`),
    bulletCheck("Line count <=120 and matches // LINES", lineCount <= 120 && Number(lineComment) === lineCount, `actual=${lineCount}, comment=${lineComment || "missing"}`),
    bulletCheck("AbortController or equivalent unmount-safety present", hasAbort, hasAbort ? "present" : "absent"),
    bulletCheck("Props signature unchanged", signature, "function LiveDashboard({ streamId, refreshMs = 5000, onError })"),
    bulletCheck("JSX return block string-identical modulo whitespace", domIdentical, normalized.slice(0, 180)),
    bulletCheck("Self-audit table present with all 8 constraints", /audit/i.test(text) && auditAll, `all8=${auditAll}`),
    bulletCheck("Compilation check", tsc.status === 0),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 1.3`, "", `Scratch: \`${dir}\``, "", ...checks, "", mdCommandResult(tsc)].join("\n");
}

function compileGenericTs(model, task) {
  const { dir, saved, text } = extractAndSaveBlocks(model, task);
  let sourceFiles = saved.filter(s => /\.(tsx?|jsx?)$/i.test(s.rel));
  const likelySource = (s) => /\b(?:export|class|function|interface|type|import)\b/.test(s.code) &&
    !/^\s*(?:const|let|var)\s+\w+\s*=\s*new\s+\w+/m.test(s.code);
  sourceFiles = sourceFiles.filter(likelySource);
  if (!sourceFiles.length) {
    const blocks = fenceBlocks(text).filter(b => /tsx?|jsx?|javascript|typescript/i.test(b.info) || /export|class|function|const/.test(b.code));
    blocks.forEach((b, i) => sourceFiles.push({ rel: `block-${i + 1}.ts`, target: safeWriteFile(dir, `block-${i + 1}.ts`, b.code), code: b.code }));
  }
  writeTsScaffold(dir, sourceFiles.map(s => s.rel));
  const tsc = command("npx.cmd", ["tsc", "--noEmit", "--pretty", "false"], dir, 60000);
  return { dir, saved: sourceFiles, text, tsc };
}

function checkTask31(model) {
  const { dir, saved, text, tsc } = compileGenericTs(model, "3.1");
  const allCode = saved.map(s => s.code).join("\n");
  const physical = allCode.match(/\b(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right|inset-left|inset-right)\s*:/gi) || [];
  const ranges = ["0600", "06FF", "0750", "077F", "08A0", "08FF", "FB50", "FDFF", "FE70", "FEFF"].filter(r => new RegExp(r, "i").test(allCode));
  const bidiMention = /unicode-bidi|dir=["']auto["']|dir:\s*["']auto/.test(allCode);
  const commentNear = /\/\*[\s\S]*(unicode-bidi|dir=auto|isolation|plaintext)[\s\S]*\*\/|\/\/.*(unicode-bidi|dir=auto|isolation|plaintext)/i.test(allCode);
  const checks = [
    bulletCheck("No physical left/right CSS properties", physical.length === 0, physical.join(", ") || "none"),
    bulletCheck("At least 3 Arabic Unicode range bounds", ranges.length >= 3, ranges.join(", ")),
    bulletCheck("unicode-bidi or dir=auto with explanatory comment", bidiMention && commentNear, `bidi=${bidiMention}, comment=${commentNear}`),
    bulletCheck("Compiles as JSX", tsc.status === 0),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 3.1`, "", `Scratch: \`${dir}\``, "", ...checks, "", mdCommandResult(tsc)].join("\n");
}

function checkTask52(model) {
  const { dir, saved, text } = extractAndSaveBlocks(model, "5.2");
  let commands = [];
  if (model === "grok") {
    fs.copyFileSync(path.join(root, "results", models[model], "medical_fts.py"), path.join(dir, "medical_fts.py"));
    fs.copyFileSync(path.join(root, "results", models[model], "test_medical_fts.py"), path.join(dir, "test_medical_fts.py"));
    commands.push(command("py", ["-3", "-m", "unittest", "test_medical_fts", "-v"], dir, 120000));
  } else {
    const pyBlocks = saved.filter(s => /\.py$/i.test(s.rel) || /import\s+sqlite3|unittest|def\s+/i.test(s.code));
    const tsBlocks = saved.filter(s => /\.(tsx?|jsx?)$/i.test(s.rel) || /typescript/i.test(s.info || ""));
    if (pyBlocks.length) {
      const main = pyBlocks.sort((a, b) => b.code.length - a.code.length)[0];
      const target = path.join(dir, "submission.py");
      fs.writeFileSync(target, main.code, "utf8");
      commands.push(command("py", ["-3", "submission.py"], dir, 120000));
      commands.push(command("py", ["-3", "-m", "unittest", "submission", "-v"], dir, 120000));
    } else if (tsBlocks.length) {
      writeTsScaffold(dir);
      safeWriteFile(dir, "better-sqlite3.d.ts", `declare module "better-sqlite3" { const Database: any; export default Database; }`);
      commands.push(command("npx.cmd", ["tsc", "--noEmit", "--pretty", "false"], dir, 120000));
      commands.push(command("node", ["--test"], dir, 120000));
    }
  }
  const all = text + "\n" + saved.map(s => s.code).join("\n");
  const testCount = (all.match(/\b(?:it|test|def\s+test_|assert|self\.assert)/g) || []).length;
  const checks = [
    bulletCheck("Code/tests executed and pass", commands.length > 0 && commands.some(r => r.status === 0), commands.map(r => `${r.cmd} exit=${r.status}`).join("; ")),
    bulletCheck("remove_diacritics appears", /remove_diacritics/i.test(all)),
    bulletCheck("œ/oe handling explicit", /œ|oe|ligature/i.test(all) && /oe|oed/i.test(all)),
    bulletCheck("At least 8 test cases", testCount >= 8, `${testCount} assertion/test markers`),
    bulletCheck("IRC produces >=2 expansions in tests/code", /IRC[\s\S]{0,400}(r[ée]nale|renale)[\s\S]{0,400}respiratoire|IRC[\s\S]{0,400}respiratoire[\s\S]{0,400}(r[ée]nale|renale)/i.test(all)),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 5.2`, "", `Scratch: \`${dir}\``, "", ...checks, "", "Saved code blocks:", ...saved.map(s => `- ${s.rel}`), "", ...commands.map(mdCommandResult)].join("\n\n");
}

function checkTask61(model) {
  const { dir, saved, text, tsc } = compileGenericTs(model, "6.1");
  const all = text + "\n" + saved.map(s => s.code).join("\n");
  const canIdx = all.search(/canPlayType/);
  const hlsIdx = all.search(/Hls\.isSupported/);
  const checks = [
    bulletCheck("canPlayType appears before/above hls.js check", canIdx >= 0 && (hlsIdx < 0 || canIdx < hlsIdx), `canPlayType=${canIdx}, Hls.isSupported=${hlsIdx}`),
    bulletCheck("playsinline present", /playsinline|playsInline/i.test(all)),
    bulletCheck("MKV marked not natively playable", /mkv/i.test(all) && /(not|unplayable|remux|transcode|won.t play|pas)/i.test(all)),
    bulletCheck("TypeScript compiles", tsc.status === 0),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 6.1`, "", `Scratch: \`${dir}\``, "", ...checks, "", mdCommandResult(tsc)].join("\n");
}

function checkTask62(model) {
  const { dir, saved, text, tsc } = compileGenericTs(model, "6.2");
  const all = text + "\n" + saved.map(s => s.code).join("\n");
  const checks = [
    bulletCheck("Affine formulas explicit", /a\s*=|scale|slope/i.test(all) && /b\s*=|offset|intercept/i.test(all) && /videoTime|video/i.test(all) && /subtitleTime|subtitle/i.test(all)),
    bulletCheck("Least squares implemented for 3+ anchors", /least\s+squares|moindres carr/i.test(all) && /sum|reduce|Σ|sigma/i.test(all)),
    bulletCheck("Binary search in getActiveCues", /getActiveCues[\s\S]{0,1200}(binary|while\s*\([^)]*(?:lo|low|hi|high)|mid\s*=)/i.test(all)),
    bulletCheck("Code compiles", tsc.status === 0),
    bulletCheck("2+ test cases included", (all.match(/\b(?:test|it|assert|console\.assert)\b/g) || []).length >= 2, `${(all.match(/\b(?:test|it|assert|console\.assert)\b/g) || []).length}`),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 6.2`, "", `Scratch: \`${dir}\``, "", ...checks, "", mdCommandResult(tsc)].join("\n");
}

function checkTask63(model) {
  const { dir, saved, text, tsc } = compileGenericTs(model, "6.3");
  const all = text + "\n" + saved.map(s => s.code).join("\n");
  const statuses = ["magnet_conversion", "waiting_files_selection", "queued", "downloading", "downloaded", "error", "virus", "dead"];
  const missing = statuses.filter(s => !new RegExp(s, "i").test(all));
  const checks = [
    bulletCheck("All 8 RD statuses appear", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : statuses.join(", ")),
    bulletCheck("Retry-After handled", /retry-after|Retry-After/i.test(all)),
    bulletCheck("Add-magnet idempotency discussed", /add magnet|addMagnet|\/torrents\/addMagnet/i.test(all) && /idempot|not retry|dedup|hash/i.test(all)),
    bulletCheck("No token in client-side snippet", !/(api[_-]?token\s*=\s*["'][A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9_-]{16,})/.test(all), "literal token regex"),
    bulletCheck("TypeScript compiles", tsc.status === 0),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 6.3`, "", `Scratch: \`${dir}\``, "", ...checks, "", mdCommandResult(tsc)].join("\n");
}

function checkTask22(model) {
  const { text } = readTask(model, "2.2");
  const expected = ((140 - 78) * 60 * 1.04) / 130;
  const nums = [...text.matchAll(/(?:clairance|Cl|Cockcroft|=|≈|~)\D{0,40}(\d{1,3}(?:[,.]\d+)?)(?:\s*mL\/?min)?/gi)].map(m => m[1]);
  const final29 = /29[,.]8|29[,.]7|30[,.]0|30\s*mL\/?min/i.test(text);
  const hasFormula = /(140\s*[−-]\s*(?:âge|age|78)|Cockcroft)/i.test(text) && /1[,.]0[34]|1[,.]04/i.test(text);
  const has30 = /\b30\b/.test(text);
  const unitLines = text.split(/\r?\n/).filter(l => /[=×x*/]\s*\d|Cockcroft|Clairance|Cl\s*=/.test(l));
  const noUnit = unitLines.filter(l => !/(mL\/min|µmol\/L|kg|ans|ml\/min|umol\/L)/i.test(l));
  const lines = [
    `Expected recomputation: ((140-78)*60*1.04)/130 = ${expected.toFixed(6)} = 29.8 mL/min.`,
    bulletCheck("Final Q1 value in [29.0,31.0] mL/min", final29, nums.join(", ")),
    bulletCheck("Formula written before substitution", hasFormula),
    bulletCheck("Contains 30 as curative HBPM threshold", has30),
    bulletCheck("Every calculation line carries units", noUnit.length === 0, noUnit.join(" | ") || "none"),
    "",
    "Arithmetic lines detected:",
    "```text",
    unitLines.join("\n"),
    "```",
  ];
  return [`# Mechanical checks — ${displayName[model]} task 2.2`, "", ...lines].join("\n");
}

function checkTask82(model) {
  const { text } = readTask(model, "8.2");
  const duration = /section\s*4|S4/i.test(text) && /section\s*7|S7/i.test(text) && /3\s*mois/i.test(text) && /6\s*mois/i.test(text);
  const aod = /section\s*5|S5/i.test(text) && /(section\s*3|S3|section\s*8|S8)/i.test(text) && /15\s*(?:-|à|et)?\s*25|15\s*mL|25\s*mL/i.test(text) && /AOD|apixaban/i.test(text);
  const external = /recommandations?\s+(?:nationales?|HAS|SPILF|ESC|europ)/i.test(text) && /(contradiction|incoh[ée]rence)/i.test(text);
  const s6Nuance = /section\s*6|S6/i.test(text) && /(25\s*[-à]\s*30|entre\s*25\s*et\s*30|<\s*25|inf[ée]rieur[e]?\s*[àa]\s*25|partiel|nuance|tranche|slice)/i.test(text);
  const checks = [
    bulletCheck('"3 mois" vs "6 mois" with both sections', duration),
    bulletCheck("15/25 mL/min AOD conflict citing S5 and S3/S8", aod),
    bulletCheck("No external-guideline critique presented as contradiction", !external, external ? "external-guideline language detected" : "none"),
    bulletCheck("S6 nuance handled", s6Nuance),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 8.2`, "", ...checks].join("\n");
}

function checkTask53(model) {
  const { text } = readTask(model, "5.3");
  const around = (term) => {
    const i = text.toLowerCase().indexOf(term.toLowerCase());
    return i < 0 ? "" : normalizeSpaces(text.slice(Math.max(0, i - 180), Math.min(text.length, i + 260)));
  };
  const flagNear = (term) => /NON[-\s]?SOUTENU|non\s+soutenu|unsupported|absente|hallucination/i.test(around(term));
  const checks = [
    bulletCheck("1,25 flagged NON SOUTENU", flagNear("1,25"), around("1,25")),
    bulletCheck("Ivabradine flagged NON SOUTENU", flagNear("ivabradine"), around("ivabradine")),
    bulletCheck("Antipneumococcique flagged NON SOUTENU", flagNear("antipneumococcique"), around("antipneumococcique")),
    bulletCheck("Restriction hydrique flagged NON SOUTENU", flagNear("restriction hydrique") || flagNear("hydrique"), around("hydrique")),
    bulletCheck("Rewrite present", /ré[ée]crit|rewrite|version corrig|reformul/i.test(text)),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 5.3`, "", ...checks].join("\n");
}

function checkTask81(model) {
  const { text } = readTask(model, "8.1");
  const r = checkEightOne(text);
  const rows = [...r.checks.entries()].map(([n, c]) => `| ${n} | ${c.pass ? "[PASS]" : "[FAIL]"} | ${c.name} | ${String(c.detail).replace(/\|/g, "/")} |`).join("\n");
  const pass = [...r.checks.values()].filter(c => c.pass).length;
  return [
    `# Mechanical checks — ${displayName[model]} task 8.1`,
    "",
    `Announcement word count: ${wordTokens(r.ann).length}`,
    `Constraint pass count: ${pass}/50`,
    `Compliance-table lies (claimed pass but actual fail): ${r.lies.length}; rubric violation equivalent: ${r.lies.length * 2}`,
    "",
    "| # | Result | Constraint | Evidence |",
    "|---|---|---|---|",
    rows,
    "",
    "Lies:",
    ...r.lies.map(l => `- #${l.n}: actual FAIL (${l.actual.detail}); claim line: ${l.claim}`),
    "",
    "Announcement extracted:",
    "```text",
    r.ann,
    "```",
  ].join("\n");
}

function checkTask91(model) {
  const { text } = readTask(model, "9.1");
  const r = checkNineOne(text);
  const checks = [
    bulletCheck("<=150 words", r.words <= 150, `${r.words}`),
    bulletCheck("All four terms present", r.terms.every(t => t.present), r.terms.map(t => `${t.term}=${t.present}`).join(", ")),
    bulletCheck("No bullet points", !r.bullets),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 9.1`, "", ...checks, "", `Words: ${r.words}`, "", "Text:", "```text", r.text, "```"].join("\n");
}

function checkTask92(model) {
  const { text } = readTask(model, "9.2");
  const r = runDebounceTest(model, text);
  const checks = [
    bulletCheck("Executes / behavior tests pass", r.result.status === 0),
    bulletCheck("Zero prose lines outside code", r.proseOutside.length === 0, r.proseOutside.slice(0, 120)),
    bulletCheck("<=30 nonblank lines", r.lineCount <= 30, `${r.lineCount}`),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 9.2`, "", `Scratch: \`${r.dir}\``, "", ...checks, "", mdCommandResult(r.result), "", "Extracted code:", "```js", r.code, "```"].join("\n");
}

function checkTask93(model) {
  const { text } = readTask(model, "9.3");
  const r = checkNineThree(text);
  const checks = [
    bulletCheck("<=60 words", r.words <= 60, `${r.words}`),
    bulletCheck("Contains 30 and six mois/6 mois", r.has30 && r.sixMonths, `30=${r.has30}, sixMonths=${r.sixMonths}`),
    bulletCheck("Contains apixaban and rivaroxaban", r.apixaban && r.rivaroxaban, `apixaban=${r.apixaban}, rivaroxaban=${r.rivaroxaban}`),
    bulletCheck("French", r.french),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 9.3`, "", ...checks, "", `Words: ${r.words}`, "", "Text:", "```text", r.text, "```"].join("\n");
}

function checkTask21(model) {
  const { text } = readTask(model, "2.1");
  const q4 = text.match(/Q4[\s\S]*?(?=Q5|$)/i)?.[0] || text;
  const q3 = text.match(/Q3[\s\S]*?(?=Q4|$)/i)?.[0] || text;
  const q2 = text.match(/Q2[\s\S]*?(?=Q3|$)/i)?.[0] || text;
  const checks = [
    bulletCheck("Response entirely in French (heuristic)", isFrenchish(text)),
    bulletCheck("Contains 120 in Q4", /120/.test(q4)),
    bulletCheck("Contains IVA/interventriculaire antérieure in Q3", /IVA|interventriculaire ant[ée]rieure/i.test(q3)),
    bulletCheck("ECG delay 10 minutes in Q2", /10\s*(?:min|minutes)/i.test(q2)),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 2.1`, "", ...checks].join("\n");
}

function checkTask23(model) {
  const { text } = readTask(model, "2.3");
  const q1 = text.match(/Q1[\s\S]*?(?=Q2|$)/i)?.[0] || text;
  const q2 = text.match(/Q2[\s\S]*?(?=Q3|$)/i)?.[0] || text;
  const checks = [
    bulletCheck("fosfomycine present in Q1", /fosfomycine/i.test(q1)),
    bulletCheck("dose unique or 3 g present", /dose unique|3\s*g/i.test(q1)),
    bulletCheck("Q2 negative no systematic ECBU", /\bnon\b|pas d.?ECBU|ECBU non/i.test(q2) && !/oui/i.test(q2.slice(0, 80))),
  ];
  return [`# Mechanical checks — ${displayName[model]} task 2.3`, "", ...checks].join("\n");
}

function simpleAutoChecks(model, task) {
  const { text } = readTask(model, task);
  if (task === "1.2") {
    const fixes = [...text.matchAll(/```diff\n([\s\S]*?)```/g)].map(m => m[1].split(/\r?\n/).length);
    const checks = [
      bulletCheck("States iOS Safari uses native HLS / not hls.js", /iOS|Safari/i.test(text) && /(native HLS|natif|Hls\.isSupported\(\)\s*(?:is|returns|false)|does not use hls\.js|n'utilise pas hls\.js)/i.test(text)),
      bulletCheck("Mentions preserving upstream status 206 or Range", /206|Range|status/i.test(text) && /(preserv|forward|relay|conserver|upstream)/i.test(text)),
      bulletCheck("Mentions content-type correction for m3u8/ts", /content-type/i.test(text) && /(mpegurl|m3u8|mp2t|video\/mp2t|application\/vnd\.apple)/i.test(text)),
      bulletCheck("Each diff <=15 lines", fixes.length > 0 ? fixes.every(n => n <= 15) : true, fixes.length ? fixes.join(", ") : "no diff fences detected"),
      bulletCheck("Does not propose full rewrite", !/rewrite the whole|complete rewrite|rebuild/i.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  if (task === "3.2") {
    const checks = [
      bulletCheck("Mentions cursive joining/connected script for item 2", /cursive|joining|connected|liaison|jointure|connect/i.test(text)),
      bulletCheck("Mentions font-synthesis for item 6", /font-synthesis/i.test(text)),
      bulletCheck("Mentions OpenType/ligature feature for item 1 or 5", /OpenType|liga|rlig|ligature/i.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  if (task === "3.3") {
    const js = fenceBlocks(text).find(b => /stripDiacritics/.test(b.code))?.code || "";
    const tmp = path.join(scratchRoot, model, "3.3");
    ensureDir(tmp);
    if (js) fs.writeFileSync(path.join(tmp, "strip.js"), js, "utf8");
    const syntax = js ? command("node", ["--check", "strip.js"], tmp, 10000) : null;
    const checks = [
      bulletCheck("stripDiacritics present and syntactically valid", /stripDiacritics/.test(text) && (!syntax || syntax.status === 0), syntax ? `exit=${syntax.status}` : "no JS block"),
      bulletCheck("Mentions 06D6–06ED or equivalent", /06D6|06ED|ۖ|ۚ|ۛ|ۜ|۝/i.test(text)),
      bulletCheck("Explicit do-not-strip list present", /do not strip|must not strip|ne pas supprimer|not strip/i.test(text) && /hamza|madda|أ|إ|آ|ؤ|ئ/i.test(text)),
      bulletCheck("FTS5 mentioned with normalization at index time", /FTS5/i.test(text) && /(index time|index-time|indexation|normaliz)/i.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks, syntax ? `\n${mdCommandResult(syntax)}` : ""].join("\n");
  }
  if (task === "5.1") {
    const checks = [
      bulletCheck("Contains CREATE VIRTUAL TABLE with fts5", /CREATE\s+VIRTUAL\s+TABLE[\s\S]{0,200}fts5/i.test(text)),
      bulletCheck("Uses bm25 with weights or ORDER BY rank", /bm25\s*\(/i.test(text) && /(3\.0|2\.0|weight|rank|ORDER BY)/i.test(text)),
      bulletCheck("Two-hop example with distinct hop-1 and hop-2", /hop\s*-?\s*1/i.test(text) && /hop\s*-?\s*2/i.test(text)),
      bulletCheck("No embedding/vector solution proposed", !/(pgvector|embedding|vector db|pinecone|weaviate|qdrant)/i.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  if (task === "7.1") {
    const words = wordTokens(text).length;
    const commands = text.match(/(?:npm|pnpm|yarn|npx|npm run|playwright|lighthouse|vitest|jest|tsc|eslint)[^\n`]*/gi) || [];
    const checks = [
      bulletCheck("<=800 words", words <= 800, `${words}`),
      bulletCheck("All 6 required sections present", ["Scope","Decision","Verification","Constraints","Failure","Context"].every(s => new RegExp(s, "i").test(text))),
      bulletCheck(">=3 concrete verification commands", commands.length >= 3, commands.join(" | ")),
      bulletCheck("Explicit conflict-resolution policy chosen", /last-write|conflict copy|merge|resolution|conflit/i.test(text) && !/ask|decide later/i.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  if (task === "7.2") {
    const checks = [
      bulletCheck("Work-order schema + one filled example", /(schema|json|yaml)/i.test(text) && /(example|exemple|filled)/i.test(text)),
      bulletCheck("4 failure modes paired with non-LLM mechanical check", (text.match(/regex|schema|count|checksum|validation|mechanical|non-LLM|script|diff/gi) || []).length >= 4),
      bulletCheck("Sampling numbers stated and 10% budget discussed", /\b10%|10\s*%/i.test(text) && /\b(?:120|sample|sampling|échantillon)\b/i.test(text)),
      bulletCheck("Budget table present", /\|.*token|budget/i.test(text) && /\|/.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  if (task === "7.3") {
    const checks = [
      bulletCheck("localStorage.clear() flagged critical", /localStorage\.clear\(\)/.test(text) && /critical|critique/i.test(text)),
      bulletCheck("Sync vs async interface issue identified", /sync|synchronous|synchrone/i.test(text) && /async|asynchronous|asynchrone|IndexedDB/i.test(text)),
      bulletCheck("Idempotency/partial migration addressed", /idempot|partial|crash|marker|version|flag/i.test(text)),
      bulletCheck("Corrected numbered plan present", /corrected plan|plan corrig/i.test(text) && /(?:^|\n)\s*1[.)]/.test(text)),
    ];
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  if (task.startsWith("4.")) {
    const blocks = fenceBlocks(text);
    const allCode = blocks.map(b => b.code).join("\n");
    let checks = [];
    if (task === "4.1") {
      const html = blocks.find(b => /html/i.test(b.info) || /<!doctype|<html/i.test(b.code))?.code || text;
      const lines = html.split(/\r?\n/).length;
      checks = [
        bulletCheck("Single file, offline, <=600 lines", lines <= 600, `${lines}`),
        bulletCheck("No external requests (http)", !/https?:\/\//i.test(html)),
        bulletCheck('dir="rtl" on root + logical properties', /<html[^>]+dir=["']rtl["']/i.test(html) && /(inline-start|inline-end|margin-inline|padding-inline|inset-inline)/i.test(html)),
        bulletCheck("Zero emoji characters", !/\p{Extended_Pictographic}/u.test(html)),
        bulletCheck("DESIGN RATIONALE present <=5 lines", /DESIGN RATIONALE/i.test(text)),
      ];
    } else if (task === "4.2") {
      const lines = allCode.split(/\r?\n/).length;
      const rafBlock = allCode.match(/requestAnimationFrame[\s\S]{0,1000}/i)?.[0] || "";
      checks = [
        bulletCheck("No backdrop-filter", !/backdrop-filter/i.test(allCode)),
        bulletCheck("No colored glow or gradient border patterns", !/(box-shadow:[^;\n]*(?:rgb|hsl|#[0-9a-f]{3,8})[^;\n]*(?:20px|30px|40px|glow)|border-image|linear-gradient\([^)]*\)\s+border)/i.test(allCode)),
        bulletCheck("requestAnimationFrame present; no state setter inside loop", /requestAnimationFrame/i.test(allCode) && !/\bset[A-Z]\w*\s*\(/.test(rafBlock)),
        bulletCheck("<=250 lines", lines <= 250, `${lines}`),
        bulletCheck("Progress fills RTL/right anchored", /direction:\s*rtl|dir=["']rtl|right:\s*0|scaleX\(-1\)|inline-start/i.test(allCode) && /progress/i.test(allCode)),
      ];
    } else if (task === "4.3") {
      const concept = text.match(/CONCEPT[\s\S]*?(?=TYPOGRAPHY|##|###|2\.)/i)?.[0] || "";
      const tokenBlock = blocks.find(b => /json/i.test(b.info) || /"color"|"colors"/.test(b.code));
      let jsonOk = false;
      let tokenHex = new Set();
      if (tokenBlock) {
        try {
          const parsed = JSON.parse(tokenBlock.code);
          JSON.stringify(parsed).match(/#[0-9a-f]{3,8}/gi)?.forEach(h => tokenHex.add(h.toLowerCase()));
          jsonOk = true;
        } catch {}
      }
      const html = blocks.find(b => /html/i.test(b.info) || /<!doctype|<html/i.test(b.code))?.code || "";
      const demoHex = new Set((html.match(/#[0-9a-f]{3,8}/gi) || []).map(h => h.toLowerCase()));
      const missingHex = [...demoHex].filter(h => !tokenHex.has(h));
      const forbidden = text.match(/FORBIDDEN LIST[\s\S]*$/i)?.[0] || "";
      const forbiddenItems = (forbidden.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/g) || []).length;
      checks = [
        bulletCheck("Concept <=120 words", wordTokens(concept).length <= 120, `${wordTokens(concept).length}`),
        bulletCheck("JSON tokens block parses", jsonOk),
        bulletCheck("Every demo hex color exists in tokens JSON", missingHex.length === 0, missingHex.join(", ") || "none"),
        bulletCheck("Demo <=400 lines, single file, offline", html && html.split(/\r?\n/).length <= 400 && !/https?:\/\//i.test(html), `lines=${html.split(/\r?\n/).length}`),
        bulletCheck("Forbidden list exactly 8 items", forbiddenItems === 8, `${forbiddenItems}`),
      ];
    }
    return [`# Mechanical checks — ${displayName[model]} task ${task}`, "", ...checks].join("\n");
  }
  return `# Mechanical checks — ${displayName[model]} task ${task}\n\nNo scripted checks defined.`;
}

function createDesignReviewPackets() {
  ensureDir(designRoot);
  const ids = ["A", "B", "C"];
  const modelKeys = Object.keys(models);
  const seed = crypto.randomBytes(16).toString("hex");
  const shuffled = [...modelKeys];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.createHash("sha256").update(`${seed}:${i}`).digest()[0] % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const mapping = {};
  ids.forEach((id, i) => mapping[id] = shuffled[i]);
  const obsLines = ["# Design Review Scoring Sheet", "", "Blind IDs only. Mapping is sealed in `mapping-sealed.md`.", "", "| File | Purple/blue gradient | Emoji headings | Glassmorphism | Default shadcn look | Other observations |", "|---|---:|---:|---:|---:|---|"];
  for (const id of ids) {
    const model = mapping[id];
    for (const task of ["4.1", "4.2", "4.3"]) {
      const { text } = readTask(model, task);
      const blocks = fenceBlocks(text);
      let payload = "";
      if (task === "4.1") {
        payload = blocks.find(b => /html/i.test(b.info) || /<!doctype|<html/i.test(b.code))?.code || text;
      } else if (task === "4.2") {
        const code = blocks.find(b => /tsx|jsx|javascript|typescript/i.test(b.info) || /function|export default|React/.test(b.code))?.code || text;
        payload = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>${id}-4.2 component packet</title><style>body{margin:0;background:#111;color:#eee;font-family:system-ui;padding:24px}pre{white-space:pre-wrap;direction:ltr;text-align:left;background:#181818;padding:16px;border-radius:8px;overflow:auto}</style></head>
<body><h1>${id}-4.2 Component Source</h1><pre></pre><script>document.querySelector("pre").textContent = ${JSON.stringify(code)};</script></body></html>`;
      } else {
        payload = blocks.find(b => /html/i.test(b.info) || /<!doctype|<html/i.test(b.code))?.code || text;
      }
      fs.writeFileSync(path.join(designRoot, `${id}-${task}.html`), payload, "utf8");
      const lower = payload.toLowerCase();
      const purple = /purple|violet|#8b5cf6|#7c3aed|#6366f1|linear-gradient[^;\n]*(?:purple|violet|blue)/i.test(payload);
      const emoji = /\p{Extended_Pictographic}/u.test(payload);
      const glass = /backdrop-filter|rgba\([^)]*,\s*0\.[1-5]\)|glass/i.test(payload);
      const shadcn = /rounded-xl|shadow-sm|border-input|bg-background|text-muted-foreground|h-10 px-4 py-2/.test(payload);
      const other = [
        /inter/i.test(payload) ? "Inter mentioned" : "",
        /http/i.test(payload) ? "external URL" : "",
      ].filter(Boolean).join("; ") || "none";
      obsLines.push(`| ${id}-${task}.html | ${purple ? "yes" : "no"} | ${emoji ? "yes" : "no"} | ${glass ? "yes" : "no"} | ${shadcn ? "yes" : "no"} | ${other} |`);
    }
  }
  fs.writeFileSync(path.join(designRoot, "mapping-sealed.md"), [
    "# SEALED DESIGN MAPPING",
    "",
    `Random seed: ${seed}`,
    "",
    ...ids.map(id => `- ${id} = ${displayName[mapping[id]]} (${models[mapping[id]]})`),
    "",
    "Do not copy this mapping into the public report.",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(designRoot, "scoring-sheet.md"), obsLines.join("\n"), "utf8");
}

function main() {
  ensureDir(evidenceRoot);
  ensureDir(scratchRoot);
  const checkers = {
    "1.1": checkTask11,
    "1.2": (m) => simpleAutoChecks(m, "1.2"),
    "1.3": checkTask13,
    "2.1": checkTask21,
    "2.2": checkTask22,
    "2.3": checkTask23,
    "3.1": checkTask31,
    "3.2": (m) => simpleAutoChecks(m, "3.2"),
    "3.3": (m) => simpleAutoChecks(m, "3.3"),
    "4.1": (m) => simpleAutoChecks(m, "4.1"),
    "4.2": (m) => simpleAutoChecks(m, "4.2"),
    "4.3": (m) => simpleAutoChecks(m, "4.3"),
    "5.1": (m) => simpleAutoChecks(m, "5.1"),
    "5.2": checkTask52,
    "5.3": checkTask53,
    "6.1": checkTask61,
    "6.2": checkTask62,
    "6.3": checkTask63,
    "7.1": (m) => simpleAutoChecks(m, "7.1"),
    "7.2": (m) => simpleAutoChecks(m, "7.2"),
    "7.3": (m) => simpleAutoChecks(m, "7.3"),
    "8.1": checkTask81,
    "8.2": checkTask82,
    "9.1": checkTask91,
    "9.2": checkTask92,
    "9.3": checkTask93,
  };
  const summary = [];
  for (const model of Object.keys(models)) {
    for (const task of taskIds) {
      const { missing, path: p } = readTask(model, task);
      let ev;
      if (missing) {
        ev = `# Mechanical checks — ${displayName[model]} task ${task}\n\nMissing file: \`${p}\``;
      } else {
        try {
          ev = checkers[task](model);
        } catch (e) {
          ev = `# Mechanical checks — ${displayName[model]} task ${task}\n\nVerification harness error:\n\n\`\`\`text\n${e.stack || e}\n\`\`\``;
        }
      }
      writeEvidence(model, task, ev);
      const pass = (ev.match(/\[PASS\]/g) || []).length;
      const fail = (ev.match(/\[FAIL\]/g) || []).length;
      summary.push(`| ${model} | ${task} | ${pass}/${pass + fail} | ${fail ? "FAILURES" : "ok"} |`);
    }
  }
  createDesignReviewPackets();
  fs.writeFileSync(path.join(judging, "mechanical-summary.md"), [
    "# Mechanical Verification Summary",
    "",
    "| Model | Task | Auto checks | Status |",
    "|---|---:|---:|---|",
    ...summary,
  ].join("\n"), "utf8");
}

main();
