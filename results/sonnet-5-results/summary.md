# KNIGHT-BENCH v1 — Run Summary

- **Model:** claude-sonnet-5
- **Run date:** 2026-07-09
- **Tasks completed:** 27/27 (1.1–9.3)

## Anomalies

1. **Task 3.1** — subagent self-reported creating a temporary scratch file in its own scratchpad directory (outside `results/sonnet-5-results/`) before writing the final output. It was not read back and no benchmark content was exposed, but it is a folder-restriction deviation. All subsequent task instructions were amended to explicitly forbid scratch files, and no further occurrences were reported.
2. **Task 7.1** — instruction violation: output is 1,063 words against the task's stated 800-word maximum. Saved as-is per protocol (no retry, no edits).
3. **Task 9.2** — minor: output wrapped in markdown code fences despite the instruction "no markdown fences if your interface allows raw output."
4. **Temperature control** — not exposed as a settable parameter in this environment for any task. All 27 runs logged with `†` per the fairness-rule fallback (nominal 0.7 for Cat 4 tasks 4.1–4.3, nominal 0.2 for all others, neither actually applied as an override).

No other anomalies (no truncation, no provider errors, no other attempted access outside the designated results folder).
