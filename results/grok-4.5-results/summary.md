# Integrity report

- **model string:** grok-4.5
- **run date:** 2026-07-09
- **completed tasks:** 26 / 26 (source IDs 1.1–9.3; no task 8.3 in knight-bench-v1.md)
- **anomalies:**
  1. Temperature not controllable in this environment — all tasks logged as `temp: default` (requested 0.2 except 4.1/4.2/4.3 requested 0.7).
  2. Effort pin not available as an API flag — high effort requested via prompt only; logged as `effort: high (prompt)`.
  3. Token counts not visible — logged as `tokens: n/a`.
  4. Task 2.2: subagent process exit code 1 with HTTP 429 free-usage rate-limit after write; `task-2.2.md` was complete and kept as the single attempt.
  5. Task 5.2: agent wrote auxiliary sandbox-local files (`medical_fts.py`, `test_medical_fts.py`, `__pycache__/`) in addition to `task-5.2.md`.
  6. Brief run interruption after task 2.1/2.2 rate-limit event; resume continued from 2.3 without re-running completed tasks.
