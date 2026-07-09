# KNIGHT-BENCH

A personal, reproducible benchmark suite for frontier LLMs against real workloads: agentic
coding, French/EDN medical reasoning, RTL/Arabic engineering, frontend design taste, medical
RAG, streaming infra, agent orchestration, long-context instruction following, and
cost-efficiency.

**Owner:** Knight (@jip7e) · **Version:** 1.0 · **Created:** 2026-07-09

## What's in this repo

```
agent-bench.md       operator playbook: how any coding agent runs a full model suite as
                      ORCHESTRATOR (sandboxing, prompt extraction, no contamination,
                      result mirroring into web-app/public/data). Point an agent at this file.
knight-bench-v1.md   the full benchmark spec: fairness rules, 26 task prompts + rubrics,
                      scoring-spreadsheet structure, judging protocol, versioning rules
judging/              the v1 judge report, per-task scorecards, mechanical auto-check
                      evidence, the blind design-taste review, and the medical review packet
results/              raw per-model outputs for every task, one folder per model
web-app/              an interactive site rendering all of the above — see web-app/README.md
```

## Running a new model (agents)

Give your coding agent **only** this instruction:

> Follow `agent-bench.md` exactly. Model under test: `<exact-model-string>`. Raw run only (no scoring).

That protocol forces the agent to stay the orchestrator, spawn a sandboxed subagent per task, extract only **Prompt (copy-paste)** blocks from `knight-bench-v1.md`, write `results/<model>-results/`, and mirror into `web-app/public/data/results/`.

## The web app

[`web-app/`](./web-app) is a Vite + React + TypeScript site (liquid-glass design system) that
renders the full benchmark: every task prompt and rubric, every raw model output, the master
score table, category breakdowns, and the judge's deep dives — read straight from this repo's
own `knight-bench-v1.md`, `judging/`, and `results/` files. Nothing in it is mocked.

```bash
cd web-app
npm install
npm run dev
```

### Deploy to Vercel

Import this repo in Vercel, set **Root Directory** to `web-app`. Framework preset (Vite),
build command, and output directory are auto-detected. No environment variables required.

## License

MIT — see [LICENSE](./LICENSE).
