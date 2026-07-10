import fs from "node:fs";

const reportPath = "judging/KNIGHT-BENCH-v1-REPORT.md";
const lines = fs.readFileSync(reportPath, "utf8").split(/\r?\n/);
let categoryTable = false;
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line === "## 3. Category Scores") categoryTable = true;
  if (line === "## GPT-5.5 Addendum") categoryTable = false;
  if (/^\| \d+\.\d+ \|/.test(line)) {
    lines[index] = line.replace(/(\|\s*\d+\/\d+)\s{2}(\d+\s+(?:FINAL|PROVISIONAL)\s+\|\s*\d+\/\d+\s+\|)$/, "$1 | $2");
  } else if (categoryTable && /^\| (?:[1-9]\.|\*\*)/.test(line)) {
    lines[index] = line.replace(/(\|\s*[\d.]+)\s{2}([\d.]+\s+\|)$/, "$1 | $2");
  }
}
fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
