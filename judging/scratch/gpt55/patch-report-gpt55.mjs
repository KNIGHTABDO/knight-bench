import fs from "node:fs";

const reportPath = "web-app/src/data/report.ts";
const scores = {
  "1.1": [6, "FINAL", 4, 6], "1.2": [9, "FINAL", 5, 5], "1.3": [8, "FINAL", 7, 7],
  "2.1": [9, "PROVISIONAL", 4, 4], "2.2": [7, "PROVISIONAL", 3, 4], "2.3": [8, "PROVISIONAL", 3, 3],
  "3.1": [8, "FINAL", 4, 4], "3.2": [9, "FINAL", 3, 3], "3.3": [10, "FINAL", 4, 4],
  "4.1": [8, "PROVISIONAL", 4, 5], "4.2": [6, "PROVISIONAL", 3, 5], "4.3": [9, "PROVISIONAL", 5, 5],
  "5.1": [8, "FINAL", 4, 4], "5.2": [2, "FINAL", 4, 5], "5.3": [10, "PROVISIONAL", 5, 5],
  "6.1": [8, "FINAL", 4, 4], "6.2": [8, "FINAL", 5, 5], "6.3": [8, "FINAL", 5, 5],
  "7.1": [6, "FINAL", 3, 4], "7.2": [9, "FINAL", 4, 4], "7.3": [10, "FINAL", 4, 4],
  "8.1": [8, "FINAL", 49, 50], "8.2": [7, "PROVISIONAL", 3, 4],
  "9.1": [8, "FINAL", 3, 3], "9.2": [6, "FINAL", 4, 5], "9.3": [9, "PROVISIONAL", 4, 4],
};
const categoryMeans = { 1: 7.67, 2: 8.0, 3: 9.0, 4: 7.67, 5: 6.67, 6: 8.0, 7: 8.33, 8: 7.5, 9: 7.67 };

let report = fs.readFileSync(reportPath, "utf8");
for (const [taskId, [score, status, autoChecksPassed, autoChecksTotal]] of Object.entries(scores)) {
  const pattern = new RegExp(`(\\{ taskId: "${taskId.replace(".", "\\.")}",[^\\n]*muse: \\{[^}]+\\})( \\},)$`, "m");
  if (!pattern.test(report)) throw new Error(`Could not locate ${taskId} score row`);
  report = report.replace(pattern, `$1, gpt55: { score: ${score}, status: "${status}", autoChecksPassed: ${autoChecksPassed}, autoChecksTotal: ${autoChecksTotal} }$2`);
}
for (const [categoryId, mean] of Object.entries(categoryMeans)) {
  const pattern = new RegExp(`(\\{ categoryId: ${categoryId},[^\\n]*muse: [^ }]+)( \\},)$`, "m");
  if (!pattern.test(report)) throw new Error(`Could not locate category ${categoryId}`);
  report = report.replace(pattern, `$1, gpt55: ${mean}$2`);
}
fs.writeFileSync(reportPath, report, "utf8");
