# KNIGHT-BENCH v1 — web app

An interactive site for [KNIGHT-BENCH v1](../knight-bench-v1.md), a personal, reproducible
benchmark suite for frontier LLMs against real workloads: agentic coding, French/EDN medical
reasoning, RTL/Arabic engineering, frontend design taste, medical RAG, streaming infra, agent
orchestration, long-context instruction following, and cost-efficiency.

Every number, prompt, rubric, and raw model output shown in this app is read directly from the
benchmark's own source files (`knight-bench-v1.md` and `judging/`, `results/` — copied verbatim
into `public/data/`) or hand-transcribed from them. Nothing is mocked or invented.

## Stack

- [Vite](https://vite.dev/) + React 19 + TypeScript
- [React Router](https://reactrouter.com/) for client-side routing
- [Tailwind CSS v4](https://tailwindcss.com/) bridged to a design-token CSS file
- [react-markdown](https://github.com/remarkjs/react-markdown) to render the raw benchmark
  markdown (prompts, scorecards, run logs) client-side, fetched from `public/data/`
- The **Liquid Glass** (iOS 26) design system — translucent frosted panes, backdrop blur, an
  ambient color-field, capsule buttons — retextured in gold/obsidian for a "knight" identity

## Structure

```
src/
  data/          typed benchmark data: categories, tasks (full prompts + rubrics), models,
                 the judge report (master score table, category scores, deep dives, traps,
                 failure taxonomy, anomalies, owner action list)
  components/    Layout (glass nav), chart components, RemoteMarkdown fetcher, shared UI
  pages/         Overview, Judge Report, Categories, Category detail, Task detail,
                 Models, Model detail, full Spec, Design review, Medical review
public/data/     verbatim copies of knight-bench-v1.md, judging/, and results/ so raw
                 model outputs, scorecards, and evidence files are fetchable at runtime
```

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

This is a static Vite SPA. `vercel.json` rewrites all routes to `index.html` for client-side
routing.

```bash
npm i -g vercel
vercel
```

Or connect the repo in the Vercel dashboard — framework preset "Vite", build command
`npm run build`, output directory `dist`. No environment variables required.

## License

MIT — see [LICENSE](./LICENSE).
