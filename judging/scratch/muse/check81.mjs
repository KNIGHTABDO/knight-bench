import { readFileSync } from "node:fs";
const md = readFileSync("results/muse-spark-1.1-results/task-8.1.md","utf8");
const ann = md.split(/\n---\r?\n/)[0].trim();
const paras = ann.split(/\r?\n\s*\r?\n/).map(p=>p.trim()).filter(Boolean);
const words = ann.split(/\s+/).filter(Boolean);
const count = (re) => (ann.match(re)||[]).length;
console.log("words:", words.length);
console.log("paras:", paras.length);
console.log("Rihla:", count(/Rihla/g));
console.log("journey:", count(/journey/gi), "seamless:", count(/seamless/gi));
console.log("emdash:", count(/—/g), "excl:", count(/!/g), "qmark:", count(/\?/g));
console.log("semicolon:", count(/;/g), "colon:", count(/:/g));
console.log("you:", count(/\byou\b/gi), "we:", count(/\bwe\b/gi));
console.log("Morocco:", count(/Morocco/g), "offline first:", count(/offline first/g), "offline-first:", count(/offline-first/g));
console.log("14 numeral:", count(/\b14\b/g));
console.log("ing count:", count(/ing/g), "matches:", (ann.match(/\w*ing\w*/g)||[]).join(","));
const zwords = [...new Set((ann.match(/\b\w*z\w*\b/gi)||[]))];
console.log("z words:", zwords.join(","), "total z-word occurrences:", (ann.match(/\b\w*z\w*\b/gi)||[]).length);
console.log("final word:", words[words.length-1]);
console.log("contractions:", count(/\b\w+'(t|s|re|ll|ve|d|m)\b/gi));
console.log("long words 12+:", [...new Set((ann.match(/\b[A-Za-z]{12,}\b/g)||[]))].join(","));
console.log("french italics:", (ann.match(/\*[^*\s]+\*/g)||[]).join(","));
console.log("para5 words:", paras[4] ? paras[4].split(/\s+/).filter(Boolean).length : "n/a");
console.log("para1 sentences:", paras[0].split(/[.!?]+/).filter(s=>s.trim()).length);
console.log("para2 first word:", paras[1].split(/\s+/)[0]);
console.log("para7 sentences:", paras[6] ? paras[6].split(/[.!?]+/).filter(s=>s.trim()).length : "n/a");
console.log("para3 map count:", (paras[2].match(/\bmap\b/gi)||[]).length);
console.log("para6 first/last:", paras[5].split(/\s+/)[0], "/", paras[5].split(/\s+/).slice(-1)[0]);
console.log("paras starting The:", paras.filter(p=>/^The\b/.test(p)).length);
console.log("oxford:", count(/, (and|or)\b/g), "matches:", (ann.match(/[^,]*, (and|or)\b[^.]*/g)||[]).join(" || "));
console.log("caps slogans:", (ann.match(/\b[A-Z]{2,}\s[A-Z]{2,}\b/g)||[]).join(","));
// sentences >24 words + exactly 4 + consecutive starters + word 3x in sentence
const sents = ann.replace(/\r?\n/g," ").split(/(?<=[.?])\s+/).filter(s=>s.trim());
let over24=0, ex4=0, dupStart=0, tripleWord=[];
let prevStart="";
for (const s of sents){
  const w = s.replace(/[*();,.?]/g,"").split(/\s+/).filter(Boolean);
  if (w.length>24) { over24++; console.log("OVER24:", s); }
  if (w.length===4) ex4++;
  const st = w[0];
  if (st && st.toLowerCase()===prevStart.toLowerCase()) { dupStart++; console.log("DUPSTART:", prevStart, "->", s); }
  prevStart = st||"";
  const freq={};
  for (const x of w){ const k=x.toLowerCase(); freq[k]=(freq[k]||0)+1; }
  for (const [k,v] of Object.entries(freq)) if (v>=3) tripleWord.push(k+" in: "+s);
}
console.log("over24:", over24, "exactly4:", ex4, "dupStart:", dupStart);
console.log("triple words:", tripleWord.join(" || ") || "none");
console.log("paras missing r:", paras.filter(p=>!/r/i.test(p)).length);
console.log("parentheticals:", (ann.match(/\([^)]*\)/g)||[]).join(","));
