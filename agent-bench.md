# KNIGHT-BENCH — Agent Orchestrator Protocol (v1)

**Purpose of this file:** Give any coding agent (Claude Code, Cursor, Codex, Grok Build, Gemini CLI, Windsurf, Aider, etc.) a complete, literal playbook to run KNIGHT-BENCH v1 as the **ORCHESTRATOR**, not as the model under test. If a human says only “follow `agent-bench.md` and run model X”, that agent must be able to finish a full integrity-clean run and update every result surface the repo uses.

**Owner of the suite:** Knight (@jip7e)  
**Spec file:** `knight-bench-v1.md` at the repository root  
**This file is NOT the benchmark questions.** It is the *how to run them safely* manual.

**Hard identity rule**

- You (the agent reading this file) are the **ORCHESTRATOR**.
- The **MODEL UNDER TEST** is a separate subagent / isolated worker / separate API call you spawn.
- You never answer a task yourself.
- You never improve, rewrite, polish, trim, or re-run a task because the answer “looks weak”.
- You never show the model under test anything except the fixed system preamble plus the verbatim task prompt.

If you violate identity rules, the entire run is invalid.

---

## 0. Absolute contamination rules (read twice)

These are non-negotiable. A single violation voids the run for scientific comparison.

1. **The model under test must never open, read, list, grep, search, or shell-access `knight-bench-v1.md`.**  
   That file contains scoring rubrics, reference answers, auto-check lists, and judge prompts. Reading it is contamination.

2. **The model under test must never read or search the `judging/` tree.**  
   Scorecards, evidence packs, reference-key reviews, and the master report live there. Contamination.

3. **The model under test must never read other models’ results.**  
   Do not let it open `results/gemini-3.5-flash-results/`, `results/grok-4.5-results/`, `results/sonnet-5-results/`, or any sibling results folder except its own designated folder.

4. **The model under test must never read `web-app/public/data/`.**  
   That tree is a published mirror of the bench, results, and judging data.

5. **You (orchestrator) may read `knight-bench-v1.md`, but only to extract the fenced block under each heading `**Prompt (copy-paste):**`.**  
   Never paste into the subagent: scoring rubrics, “Reference answers”, “Reference key”, auto-check lists, token estimates, category weights, judge prompts, or any commentary outside that fence.

6. **If even one sentence of rubric or reference key leaks into a subagent message, abort that task’s validity, log the contamination, and do not “quietly continue” as if nothing happened.**  
   Preferred recovery: delete only that contaminated `task-*.md` if it was written after the leak, re-spawn with a clean paste, and mark the anomaly. Do not re-run clean tasks.

7. **Real incident (Gemini run):** the first Gemini subagent for task 1.1 attempted to open `knight-bench-v1.md`. That run was aborted and restarted. Treat any such attempt as a kill-switch event.

8. **Contamination audit at the end of every run is mandatory.**  
   Search every subagent transcript / tool log for:
   - `knight-bench-v1`
   - `target_file` pointing outside the results sandbox
   - `../` traversal toward the repo root
   - reads under `judging/`  
   The string `knight-bench-v1.md` is allowed only inside the forbid text of the sandbox preamble (for example “Do not open knight-bench-v1.md”). A tool call that *opens* that path is contamination.

---

## 1. Repository map (current tree that matters)

Repository root (example absolute path on the machine that already ran Grok):  
`C:\Users\hiba\Desktop\KNIGHT-BENCH`

```
KNIGHT-BENCH/
  agent-bench.md              ← THIS FILE (orchestrator protocol)
  knight-bench-v1.md          ← FULL SPEC + PROMPTS + RUBRICS (orchestrator-only for extraction)
  README.md
  CONTRIBUTING.md
  LICENSE
  results/                    ← RAW MODEL OUTPUTS (primary artifact of a run)
    gemini-3.5-flash-results/
    grok-4.5-results/
    sonnet-5-results/
  judging/                    ← SCORING / EVIDENCE (NOT for model under test; usually human later)
    evidence/
    scorecards/
    design-review/
    human-review/
    tools/
      verify.mjs
      write_reports.mjs
    KNIGHT-BENCH-v1-REPORT.md
    mechanical-summary.md
  web-app/                    ← SITE THAT DISPLAYS EVERYTHING
    public/data/
      knight-bench-v1.md      ← copy of root spec
      results/                ← MUST stay mirrored with root results/
      judging/                ← mirrored judging artifacts
    src/data/
      models.ts               ← model registry + headline numbers
      tasks.ts                ← prompts/rubrics transcribed for UI
      report.ts               ← score tables
      categories.ts
      types.ts
```

Existing completed raw-result folders (as of this writing):

| Display name        | Folder under `results/`           | Web model id |
|---------------------|-----------------------------------|--------------|
| Gemini 3.5 Flash    | `gemini-3.5-flash-results`        | `gemini`     |
| Grok 4.5            | `grok-4.5-results`                | `grok`       |
| Claude Sonnet 5     | `sonnet-5-results`                | `sonnet`     |

**Task count fact (do not invent a 27th coding task):**  
Category 8 has only **8.1** and **8.2** (no 8.3).  
There are exactly **26** task IDs in v1:

`1.1 1.2 1.3 2.1 2.2 2.3 3.1 3.2 3.3 4.1 4.2 4.3 5.1 5.2 5.3 6.1 6.2 6.3 7.1 7.2 7.3 8.1 8.2 9.1 9.2 9.3`

The fairness text in `knight-bench-v1.md` sometimes says “27 tasks” colloquially; the source file’s headings define **26**. Complete all 26. Do not invent `task-8.3.md`.

---

## 2. Roles and products of a run

### 2.1 What a successful raw run produces

Under `results/<model-folder>/` you must create:

| File | Meaning |
|------|---------|
| `run-log.md` | One entry per task: id, timestamp, model string, temperature note, tokens if known, anomalies |
| `task-1.1.md` … `task-9.3.md` | Full raw model answers (26 files). Never edited by the orchestrator after save. |
| `summary.md` | Integrity report only: model string, run date, completed count, anomaly list. **No scores. No quality opinions.** |

### 2.2 What a run does NOT produce (unless the human explicitly asked for a full judge cycle)

- Scorecards under `judging/scorecards/`
- Evidence under `judging/evidence/`
- Changes to `judging/KNIGHT-BENCH-v1-REPORT.md` or `web-app/src/data/report.ts` weighted totals

Those are **judging**, not **execution**. Execution ends when raw outputs + integrity files exist and are mirrored for the web app.

### 2.3 What the orchestrator must update so the site can show the run

After raw outputs exist:

1. Mirror `results/<model-folder>/` into `web-app/public/data/results/<model-folder>/` (full copy of `task-*.md`, `run-log.md`, `summary.md`).
2. If this is a **new** model not already in `web-app/src/data/models.ts`, register it there (see Section 12). Use provisional score fields of `0` until human judging fills real numbers—or leave the model out of the scored UI and only ship files under `results/` + `public/data/results/` if the human said “raw run only”.
3. Do **not** invent weighted totals. Existing models already have judged numbers in `models.ts` and `report.ts`. Overwriting them without a full re-judge is fraud.

---

## 3. STEP 0 — Model selection (hard gate)

Before any folder is created or any task is run:

1. Identify the **exact model name/version string** the subagent will run on (examples already used: `gemini-3.5-flash`, `grok-4.5`, `claude-sonnet-5`).
2. Confirm you can actually pin a subagent / worker / API call to that model.
3. If you have **any** doubt (even 1%) about either (a) which model is intended, or (b) whether you can pin it, **stop and ask the human:**  
   `Which model should the subagent run on?`  
   Do nothing else until they answer.
4. Once locked, state the exact string once (example: `Model locked: grok-4.5`) and proceed. Do not re-ask for confirmation on every task.

### 3.1 Folder naming rule

Create:

`results/<lowercase-hyphenated-model-string>-results/`

Examples that already exist:

- `results/gemini-3.5-flash-results/`
- `results/grok-4.5-results/`
- `results/sonnet-5-results/`

If the human says “run GPT-5.6”, the folder is `results/gpt-5.6-results/` (or whatever exact string they locked—keep the lock and the folder name consistent forever).

### 3.2 Capability preferences

Prefer, in order:

1. Your environment’s most capable model the human named, with highest available reasoning / effort if that control exists.
2. Temperature pin if available (Section 6).
3. If a control does not exist, log it—do not fake the control.

---

## 4. STEP 1 — Workspace setup

1. Ensure `results/` exists at the repo root.
2. Create `results/<model-folder>/` if missing.
3. Create empty `results/<model-folder>/run-log.md` if missing.
4. Do not delete an existing folder that already contains completed `task-*.md` files unless the human explicitly orders a full re-run.
5. If resuming a partial run, list existing `task-*.md` files and **skip only those that are complete and non-contaminated**. Never re-run a complete task because you dislike the prose.

### 4.1 Resume protocol (used successfully on the Grok run)

- Incomplete or missing tasks: continue in order.
- Provider 429 / rate-limit after the answer file was fully written: **keep the file**, log the anomaly, do not rewrite the answer.
- Provider failure with empty or truncated file: retry the **API call** once with the **same** prompt (fairness rule: retry the call, never edit the prompt). If still broken, log and leave the anomaly; do not invent content.

---

## 5. STEP 2 — Sandbox rules for every subagent

### 5.1 Working directory

Pin the subagent’s working directory (cwd) to:

`results/<model-folder>/`

Example for Grok:

`C:\Users\hiba\Desktop\KNIGHT-BENCH\results\grok-4.5-results`

If the tool API supports path restrictions, apply:

- read/write limited to that folder
- no web access
- no parent directory listing

### 5.2 Prompt-level restriction (always include, even if API supports hard limits)

Include this **verbatim** in every subagent spawn:

```
You may only write inside your current folder. You must never access any other path. You must never attempt to locate the benchmark source file.
Do not list parent directories. Do not read any file outside this folder. Do not use web search. Do not open knight-bench-v1.md or any path outside your cwd.
Do not create scratch files outside this folder. Write only the required task-*.md answer file (and any code files the task itself requires you to produce as part of the answer, still only inside this folder).
```

### 5.3 One task → one isolated worker (recommended fairness mode)

**Recommended (used for Grok, Gemini restart, Sonnet):** spawn a **fresh** subagent per task so earlier answers cannot contaminate later ones.

Alternative (only if the environment forces a single long-lived agent): sequential messages, still one attempt each, still no coaching. Cross-task memory is a fairness risk—log it as an anomaly if you must use it.

### 5.4 Subagent type

Use the general-purpose / full-capability coding worker (not a read-only “explore” agent) so it can write `task-*.md`. Disable tools that are irrelevant (web search) when possible.

### 5.5 What the subagent must write

For task ID `T` (example `2.1`):

- Create or overwrite `task-2.1.md` in its cwd with the **full raw answer**.
- Then stop.
- Do not also write a summary for the orchestrator that replaces the file.

### 5.6 Auxiliary files (observed on Grok 5.2)

If a task asks for runnable code with tests (example 5.2), the model may also write `medical_fts.py`, `test_medical_fts.py`, `__pycache__/`, etc. inside the sandbox. That is allowed if still inside the results folder. Log it as an anomaly of form “auxiliary sandbox-local files written”. The canonical answer remains `task-5.2.md`.

### 5.7 Forbidden: scratch outside sandbox (observed on Sonnet 3.1)

If the subagent writes temp files outside `results/<model-folder>/`, log a **folder-restriction deviation**. Prefer killing that worker if detected mid-flight. Do not read those temps into later tasks.

---

## 6. Fairness parameters (from `knight-bench-v1.md` §0)

### 6.1 System preamble (identical for every task, every model)

Exactly this, then a blank line, then the task prompt:

```
You are an expert assistant. Answer the task exactly as specified. If a format is required, follow it precisely. If you are uncertain about a factual claim, say so explicitly rather than guessing.
```

### 6.2 Temperature

| Tasks | Target temperature |
|-------|--------------------|
| `4.1`, `4.2`, `4.3` | `0.7` |
| All other tasks | `0.2` |

If temperature cannot be set in your environment: still *request* it in logs as nominal, and mark with dagger `†` meaning uncontrolled default. Do not pretend you set it.

### 6.3 Tools

- **Web search OFF** for all tasks (especially medical Categories 2, 5.3, 8.2).
- No browsing, no fetching external docs for the model under test.
- The model may use local tools only to write its answer file inside the sandbox.

### 6.4 Max output tokens (when the API exposes the control)

| Tasks | Max output tokens |
|-------|-------------------|
| Default for most tasks | 8000 |
| `1.1`, `4.3` | 16000 |
| Category 9 (`9.1`, `9.2`, `9.3`) | Follow the task’s own hard budgets (word/line limits); keep API max high enough that the model is not truncated mid-answer, but the task still self-limits content |

If the API truncates, log truncation as an anomaly. Do not “continue generation” as a second attempt unless the first response is empty due to provider error.

### 6.5 One attempt

- One successful model response per task.
- Retry only pure infrastructure failures (timeout, 429 before any content, empty body) with the **identical** prompt.
- Never rephrase. Never add “please try harder”. Never answer clarifying questions from the subagent—its partial or questioning output stands.

### 6.6 Effort / reasoning

If the human asked for high effort / max thinking / extended reasoning, enable it when the API allows. If not available, log `effort: default` or `effort: high (prompt-only)` if you only wrote it into instructions.

---

## 7. STEP 3 — Task extraction (orchestrator only)

### 7.1 Source

Open only:

`knight-bench-v1.md`

(at repo root; also mirrored at `web-app/public/data/knight-bench-v1.md`—prefer the root file).

### 7.2 Extraction algorithm

For each task heading such as `### Task 1.1 — …`:

1. Find the line `**Prompt (copy-paste):**`.
2. Take the immediately following fenced code block that starts with a line containing only triple backticks and ends at the next triple-backtick fence.
3. The **interior** of that fence is the prompt. Preserve every character: spaces, Arabic text, French accents, code, blank lines.
4. **Stop** at the closing fence. Do not include:
   - `**Scoring rubric (0–10):**`
   - `**Reference answers**` / `**Reference key**`
   - `**Auto-checks:**`
   - `**Estimated tokens:**`
   - Category intros, weights, or fairness section text

### 7.3 Transmission

Send the prompt to the subagent as **pasted text in the spawn message**.  
Never send a file path like “read task from knight-bench-v1.md”.  
Never send “see results/gemini… for inspiration”.

### 7.4 Full message shape for each task

```
SANDBOX (non-negotiable):
You may only write inside your current folder. You must never access any other path. You must never attempt to locate the benchmark source file.
Do not list parent directories. Do not read any file outside this folder. Do not use web search. Do not open knight-bench-v1.md or any path outside your cwd.
Do not create scratch files outside this folder. Write your full raw answer to the file task-<ID>.md in your current folder (overwrite if needed). After writing that file, stop.

Use maximum thoroughness / high effort when your runtime supports it.

---

You are an expert assistant. Answer the task exactly as specified. If a format is required, follow it precisely. If you are uncertain about a factual claim, say so explicitly rather than guessing.

<PASTE VERBATIM PROMPT BODY HERE>
```

Replace `task-<ID>.md` with the real filename for that task, for example `task-1.1.md`.

### 7.5 Optional temperature note in spawn (only if API cannot set temp)

For tasks 4.1–4.3 you may add one line after the sandbox block:

`Note: intended temperature for this creative task is 0.7 (if not controllable, answer at full design quality anyway).`

For other tasks you may add:

`Note: intended temperature is 0.2 (if not controllable, prefer precise factual answers over flourish).`

Do not invent extra coaching beyond that.

---

## 8. STEP 4 — Execution order

Run tasks **strictly in this order**:

1. `1.1` Multi-file feature in a Next.js repo  
2. `1.2` Debugging a broken HLS pipeline from logs  
3. `1.3` Refactoring under hard constraints  
4. `2.1` Dossier progressif (SCA ST+) — French medical  
5. `2.2` Clinical calculation (Cockcroft + dose) — French  
6. `2.3` Trap question cystite / SPILF-HAS — French  
7. `3.1` BilingualComposer bidi React component  
8. `3.2` Arabic typography edge cases  
9. `3.3` Quranic text handling design  
10. `4.1` MADAR landing page (design, temp 0.7)  
11. `4.2` Quran audio now-playing component (design, temp 0.7)  
12. `4.3` SIRAJ visual identity system (design, temp 0.7)  
13. `5.1` Multi-hop FTS5 retrieval pipeline  
14. `5.2` BM25 tuning code for medical French  
15. `5.3` Hallucinated citation verifier — French  
16. `6.1` Safari-compatible HLS playback layer  
17. `6.2` Subtitle sync algorithm  
18. `6.3` Real-Debrid API client for Workers  
19. `7.1` Handoff brief for coding agent  
20. `7.2` Planner/executor/verifier 10-80-10 design  
21. `7.3` Critique bad localStorage→IndexedDB plan  
22. `8.1` 50-constraint Rihla announcement  
23. `8.2` Buried contradictions in French anticoagulation protocol  
24. `9.1` SSR/SSG/ISR/streaming ≤150 words  
25. `9.2` `debounceWithFlush` ≤30 lines, code only  
26. `9.3` French medical summary ≤60 words  

After each task:

1. Verify `task-<id>.md` exists and has non-trivial size (not empty).
2. Append one line (or table row) to `run-log.md`.
3. Proceed to the next task. No quality review loop.

### 8.1 Run-log line format (accepted patterns)

Either style is fine if consistent within a run.

**Style A (Gemini / Grok-like):**

```
1.1 | 2026-07-09T12:58:22+01:00 | grok-4.5 | temp: default† | effort: high (prompt) | tokens: n/a | anomaly: none
```

**Style B (Sonnet-like markdown table):**

```markdown
| task_id | timestamp | model | temp | notes |
|---|---|---|---|---|
| 1.1 | 2026-07-09T00:00Z | claude-sonnet-5 | 0.2† | OK, saved task-1.1.md, no anomalies |
```

Always include:

- task id  
- ISO timestamp  
- exact model string  
- temperature reality (`0.2`, `0.7`, or `default†`)  
- token counts if visible, else `n/a`  
- any anomaly (truncation, 429, sandbox violation attempt, aux files, resume)

### 8.2 Orchestrator must not

- Score the answer  
- Fix medical facts  
- Trim over-budget answers for the model  
- Re-run because task 8.1 failed constraints  
- Tell the next task “last time you forgot X”

---

## 9. STEP 5 — Integrity report (`summary.md`)

When all 26 `task-*.md` files exist, write `results/<model-folder>/summary.md` containing **only**:

- model string  
- run date (ISO date is enough)  
- count of completed tasks (`26/26` when full)  
- list of anomalies  

**Forbidden in summary.md:** self-scoring, “looks strong”, category opinions, comparison to other models.

### 9.1 Example structure (adapt fields; do not invent scores)

```markdown
# Integrity report

- **model string:** grok-4.5
- **run date:** 2026-07-09
- **completed tasks:** 26 / 26
- **anomalies:**
  1. Temperature not controllable — logged as temp: default†
  2. …
```

---

## 10. Mandatory end-of-run contamination audit

Before declaring the run finished:

1. Confirm 26 files: `task-1.1.md` through `task-9.3.md` (skip non-existent 8.3).  
2. Confirm `run-log.md` has 26 task entries.  
3. Confirm `summary.md` exists and has no scores.  
4. Audit subagent tool logs / session transcripts if available:
   - No successful `read_file` / `grep` / shell read of `knight-bench-v1.md`
   - No access to `judging/`
   - No access to other models’ results folders  
5. If the environment stores child sessions (Grok Build pattern: sessions under a path that includes `results\grok-4.5-results\<subagent-id>\chat_history.jsonl`), JSON-parse tool_calls and list every `target_file` / `file_path` / shell `command`. All writes and reads must stay under the results sandbox (except impossible system noise).  
6. Record audit outcome in the human reply and, if any violation was found mid-run, in `summary.md` anomalies.

**Proven clean pattern (Grok 4.5 run):**  
All subagent `read_file` targets were only files inside `results/grok-4.5-results/` (`task-1.1.md`, `medical_fts.py`, `test_medical_fts.py`). Zero tool calls opened the bench file. The orchestrator alone had read `knight-bench-v1.md`.

---

## 11. Mirror results into the web app (required for visibility)

The site loads raw outputs from:

`web-app/public/data/results/<model-folder>/task-<id>.md`  
`web-app/public/data/results/<model-folder>/summary.md`  
`web-app/public/data/results/<model-folder>/run-log.md`

### 11.1 Copy command (Windows PowerShell)

Run from the repository root. Example for a finished Grok folder (repeat the same pattern for any model folder name you used):

```powershell
$src = "results\grok-4.5-results"
$dst = "web-app\public\data\results\grok-4.5-results"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path "$src\task-*.md","$src\run-log.md","$src\summary.md" -Destination $dst -Force
```

For a new model folder named exactly `results\gpt-5.6-results`:

```powershell
$src = "results\gpt-5.6-results"
$dst = "web-app\public\data\results\gpt-5.6-results"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path "$src\task-*.md","$src\run-log.md","$src\summary.md" -Destination $dst -Force
```

Optional: copy sandbox-local code companions if you want them browseable (not required for UI):

```powershell
Copy-Item -Path "$src\*.py" -Destination $dst -Force -ErrorAction SilentlyContinue
```

Do **not** copy `__pycache__`.

### 11.2 Copy command (Unix shell)

```bash
mkdir -p web-app/public/data/results/grok-4.5-results
cp results/grok-4.5-results/task-*.md \
   results/grok-4.5-results/run-log.md \
   results/grok-4.5-results/summary.md \
   web-app/public/data/results/grok-4.5-results/
```

### 11.3 Keep root and public data in sync

After every run or resume that changes results files, re-copy. The web app does not automatically watch the root `results/` tree at runtime; it serves `public/data/`.

---

## 12. Registering a brand-new model in the web app (only when asked)

Existing models are already registered in `web-app/src/data/models.ts` with judged weighted totals.  

If the human wants a **new** model to appear in the Models UI before judging:

1. Add a short id, display name, and `resultsDir` matching the folder name under `results/`.
2. Set numeric score fields to `0` (or omit until judging—prefer asking the human).  
3. Extend `web-app/src/data/types.ts` `ModelId` union if it is a closed union.  
4. Extend `web-app/src/data/modelVisuals.ts` color map.  
5. Extend `web-app/src/data/report.ts` master/category tables with empty or provisional cells—**only if the human wants UI completeness**. Otherwise leave report tables alone and only ship raw files.

**Default for a raw benchmark run:**  
Write `results/` + mirror `public/data/results/`. Do **not** invent scores in `report.ts`. Tell the human: “Raw run complete; scoring is separate.”

---

## 13. What judging looks like later (orchestrator awareness only)

Do not run this unless the human explicitly requests judging.

- Mechanical checks: `judging/tools/verify.mjs` (expects root cwd, knows the three current model folder names).  
- Scorecards land under `judging/scorecards/<gemini|grok|sonnet>/task-*.md`.  
- Evidence under `judging/evidence/<model>/`.  
- Design tasks 4.x are judged **blind** from HTML renders under `judging/design-review/`.  
- Medical tasks 2.1, 2.2, 2.3, 5.3, 8.2 are **human-final** against collèges/HAS/SPILF; judge models may pre-annotate only.  
- Judge model prompt lives in `knight-bench-v1.md` §11—never show it to the model under test during a raw run.

---

## 14. Lessons from completed v1 runs (do not repeat mistakes)

### 14.1 Gemini 3.5 Flash

- First subagent tried to open `knight-bench-v1.md` → kill, abort, full restart with stricter sandbox.  
- Final status: 26/26 tasks, anomaly documented in `results/gemini-3.5-flash-results/summary.md`.

### 14.2 Grok 4.5

- Orchestrator extracted prompts; subagents sandboxed to `results/grok-4.5-results/`.  
- Fresh subagent per task.  
- Temperature not pin-able → `temp: default†` / prompt notes for 0.7 on design.  
- High effort requested via prompt when API had no effort flag.  
- Task 2.2: process exited with 429 after full write → kept file, no rewrite.  
- Task 5.2: wrote auxiliary Python files in sandbox → logged.  
- Mid-run interrupt → resume from next incomplete task without redoing completed ones.  
- Contamination audit: no subagent tool opened the bench file.

### 14.3 Claude Sonnet 5

- Folder: `results/sonnet-5-results/`.  
- Task 3.1: scratch outside sandbox → anomaly.  
- Task 7.1: exceeded 800-word limit → saved as-is (no retry).  
- Task 9.2: markdown fences despite “no fences if allowed” → minor anomaly.  
- Temperature uncontrolled → `†` on every line.

### 14.4 General

- Never parallelize multiple tasks on the same model if that risks shared memory or shared cwd pollution; sequential is safer. Parallel independent fresh sandboxes are acceptable only if each has its own cwd and no shared context—and only if the human wants speed over strict ordering. Prefer sequential in order 1.1→9.3.  
- Rate limits: wait and resume; do not fabricate answers.  
- Do not “help” medical French with your own knowledge into the output file.

---

## 15. Category map (for human communication only; never score during run)

| Cat | Name | Weight | Task IDs |
|-----|------|--------|----------|
| 1 | Agentic Coding | 20% | 1.1 1.2 1.3 |
| 2 | Medical Reasoning FR/EDN | 20% | 2.1 2.2 2.3 |
| 3 | RTL/Arabic Engineering | 10% | 3.1 3.2 3.3 |
| 4 | Frontend Design Taste | 15% | 4.1 4.2 4.3 |
| 5 | Medical RAG / Retrieval | 15% | 5.1 5.2 5.3 |
| 6 | Streaming / Media Infra | 5% | 6.1 6.2 6.3 |
| 7 | Agent Orchestration | 10% | 7.1 7.2 7.3 |
| 8 | Long-Context + IF | 2.5% | 8.1 8.2 |
| 9 | Cost / Latency | 2.5% | 9.1 9.2 9.3 |

Headline score formula (judging phase only):  
`TOTAL = Σ (category_mean × weight)` on a 0–10 scale.

---

## 16. Orchestrator checklist (print mentally before starting)

- [ ] I am not the model under test  
- [ ] Model string locked with human if any doubt  
- [ ] `results/<model-folder>/` + empty or appendable `run-log.md`  
- [ ] Subagent cwd = that folder only  
- [ ] Sandbox forbid text in every spawn  
- [ ] Extract only Prompt (copy-paste) fences from `knight-bench-v1.md`  
- [ ] System preamble exact  
- [ ] Temp 0.7 for 4.x else 0.2, or log `†`  
- [ ] Web search off  
- [ ] One attempt per task; no coaching  
- [ ] Save raw `task-*.md` without editing  
- [ ] Log each task  
- [ ] All 26 files present  
- [ ] `summary.md` integrity only  
- [ ] Contamination audit of tool logs  
- [ ] Mirror into `web-app/public/data/results/<model-folder>/`  
- [ ] Do not invent scores in `report.ts` / `models.ts` unless human ordered a full judge cycle  

---

## 17. Failure taxonomy (how to log)

| Event | Action |
|-------|--------|
| Subagent opens or tries to open `knight-bench-v1.md` | Kill worker; abort task; mark contamination; restart task only with cleaner isolation; if rubrics already entered context, restart that task from zero with a new worker |
| Subagent lists parent directory | Log anomaly; if listing revealed the bench filename only, still high risk—prefer kill |
| Empty response | Retry same prompt once (infra) |
| Truncated response | Log truncation; do not continue as attempt 2 unless human allows explicit continuation policy for provider bugs |
| 429 after full file written | Keep file; log 429 |
| 429 before any write | Wait / resume later; same prompt |
| Output violates word limit | Keep as-is; log instruction violation |
| Orchestrator accidentally pasted a rubric | Invalidate that task; re-extract carefully; re-run only that task |

---

## 18. Exact orchestrator workflow (end-to-end algorithm)

1. **Lock model** with human if needed.  
2. **Create** `results/<model-folder>/run-log.md`.  
3. **For each task ID in Section 8 order:**  
   a. Extract prompt fence only from `knight-bench-v1.md`.  
   b. Spawn fresh subagent, cwd = results folder, sandbox text + preamble + prompt.  
   c. Wait for completion.  
   d. Verify `task-<id>.md`.  
   e. Append run-log line.  
   f. If subagent attempted escape, handle per Section 17.  
4. **Write** `summary.md`.  
5. **Audit** contamination.  
6. **Mirror** to `web-app/public/data/results/<model-folder>/`.  
7. **Report to human:** model string, path to folder, 26/26 or missing list, anomaly list, contamination audit pass/fail.  
8. **Stop.** Do not score.

---

## 19. Human one-liner invocations (what this file optimizes for)

Examples of what a human might say:

- “Follow `agent-bench.md` and run Gemini 3.5 Flash.”  
- “Follow `agent-bench.md`; model is grok-4.5; high effort; resume if partial.”  
- “Follow `agent-bench.md` for Claude Sonnet 5; raw outputs only, no scoring.”  

In all cases the agent does Sections 3–11 and 18 without asking for a second copy of the fairness rules.

---

## 20. Files the orchestrator may touch vs must not touch

### May create / update during a raw run

- `results/<model-folder>/run-log.md`  
- `results/<model-folder>/task-*.md` (via subagent)  
- `results/<model-folder>/summary.md`  
- `web-app/public/data/results/<model-folder>/*` (mirror)  
- Optional: new entry in `web-app/src/data/models.ts` **only if human requested registration**

### Must not touch during a raw run

- Rubrics or reference keys inside `knight-bench-v1.md` (do not edit the suite while running)  
- `judging/scorecards/**`  
- `judging/evidence/**`  
- `judging/KNIGHT-BENCH-v1-REPORT.md`  
- `web-app/src/data/report.ts` score tables (unless human ordered re-judge)  
- Other models’ result folders  
- Subagent answer bodies after save  

---

## 21. Sanity sizes (optional, for detecting empty/truncated files)

These are **not** scoring. After each write, a near-zero-byte file is a red flag.

Observed ballparks from prior full runs (order of magnitude only):

| Task | Typical character scale |
|------|-------------------------|
| 1.1 | very large (multi-file code) |
| 2.3 | short French Q&A |
| 4.1–4.3 | large HTML / design systems |
| 8.1 | medium (constrained prose + table) |
| 9.1–9.3 | deliberately tiny |

If `task-9.1.md` is 50 KB of fluff, still **do not re-run**—log only. Scoring will punish budget violations later.

---

## 22. Final integrity oath (orchestrator)

I will:

1. Keep the model under test blind to rubrics and keys.  
2. Paste only the Prompt (copy-paste) fence.  
3. Use one attempt and save raw outputs.  
4. Log every anomaly honestly.  
5. Mirror files so the web app can show results.  
6. Never invent scores.  
7. Never lie about contamination.

If I cannot pin the model, I will ask. If I contaminate a task, I will say so.

---

*End of agent-bench.md — KNIGHT-BENCH v1 orchestrator protocol.*  
*Companion suite file: `knight-bench-v1.md`.*  
*Do not paste this orchestrator file into the model under test either; it is operator documentation, not a task prompt.*
