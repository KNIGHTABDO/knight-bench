import fs from "node:fs";

const reportPath = "judging/KNIGHT-BENCH-v1-REPORT.md";
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
const means = { 1: "7.67", 2: "8.00", 3: "9.00", 4: "7.67", 5: "6.67", 6: "8.00", 7: "8.33", 8: "7.50", 9: "7.67" };
let text = fs.readFileSync(reportPath, "utf8");
text = text.replace(/^Conflict statement:.*$/m, "Conflict statement: GPT-5.5 was judged by GPT-5-based Codex, the same model family as the subject, so its result is conflict-provisional pending an independent re-score. Muse Spark 1.1 may also share its Claude-family judge; its first place remains provisional. All GPT-5.5 scores >=9 are tied to a compile, run, grep, word count, or scripted constraint result, and medical/design tasks remain owner-provisional.");
text = text.replace(/^Scope note:.*$/m, "Scope note: the benchmark defines 26 task headings, not a phantom 27th task. Five models are now scored (130 model-task outputs): Gemini, Grok, Sonnet, Muse, and GPT-5.5.");
text = text.replace(/^Overall winner.*$/m, "Overall winner on all provisional+final scores: **Muse Spark 1.1** (8.283/10), ahead of GPT-5.5 (7.796), Grok 4.5 (7.767), Claude Sonnet 5 (7.529), and Gemini 3.5 Flash (7.208). GPT-5.5 is conflict-provisional; Muse also retains owner-pending medical/design scores.");
text = text.replace(/^Personality read grounded in outputs:.*$/m, "Personality read grounded in outputs: GPT-5.5 is strong on Arabic engineering, HLS diagnosis, citation verification, and migration critique, but its supplied FTS5 test suite fails and it loses hard-constraint points in 8.1 and 9.2. Existing model descriptions remain unchanged; all provisional qualifications apply.");
const lines = text.split(/\r?\n/);
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line === "| Task | Gemini | Auto | Grok | Auto | Sonnet | Auto | Muse | Auto |") lines[index] = "| Task | Gemini | Auto | Grok | Auto | Sonnet | Auto | Muse | Auto | GPT-5.5 | Auto |";
  else if (line === "|---|---:|---:|---:|---:|---:|---:|---:|---:|") lines[index] = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  else if (/^\| \d+\.\d+ \|/.test(line)) {
    const task = line.split("|")[1].trim();
    const [score, status, pass, total] = scores[task];
    lines[index] = `${line.slice(0, -1)} | ${score} ${status} | ${pass}/${total} |`;
  } else if (line === "| Category | Weight | Gemini | Grok | Sonnet | Muse |") lines[index] = "| Category | Weight | Gemini | Grok | Sonnet | Muse | GPT-5.5 |";
  else if (line === "|---|---:|---:|---:|---:|---:|") lines[index] = "|---|---:|---:|---:|---:|---:|---:|";
  else if (/^\| [1-9]\. /.test(line)) {
    const category = line.match(/^\| (\d+)\./)[1];
    lines[index] = `${line.slice(0, -1)} | ${means[category]} |`;
  } else if (line.startsWith("| **Weighted total (all scores)**")) lines[index] = `${line.slice(0, -1)} | 7.796 |`;
  else if (line.startsWith("| **FINAL-only normalized**")) lines[index] = `${line.slice(0, -1)} | 7.568 |`;
  else if (line.startsWith("| **Settled contribution to 0-10 total**")) lines[index] = `${line.slice(0, -1)} | 4.383 |`;
}
text = lines.join("\n");
text = text.replace(
  "| Muse Spark 1.1 | 8.283 | 4.758 | 8.967 | 4.758-8.967 |",
  "| Muse Spark 1.1 | 8.283 | 4.758 | 8.967 | 4.758-8.967 |\n| GPT-5.5 | 7.796 | 4.383 | 8.592 | 4.383-8.592 |",
);
text = text.replace(
  "## 4. Head-To-Head Deep Dives",
  "## GPT-5.5 Addendum\n\nGPT-5.5 ranks second on the current all-score total. Its final-task result is 7.568 normalized, and its provisional swing is 4.383-8.592. It ties Muse in Categories 1 and 4, but no category winner changes under the existing tie policy. The Python FTS5 implementation is the decisive weakness: all 12 supplied tests fail with a malformed-database error.\n\n## 4. Head-To-Head Deep Dives",
);
fs.writeFileSync(reportPath, text, "utf8");
