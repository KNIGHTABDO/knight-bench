# Integrity report

- **model string:** muse-spark-1.1
- **run date:** 2026-07-09
- **completed tasks:** 26 / 26
- **anomalies:**
  1. Temperature not controllable — logged as temp: default† (prompt notes for 0.7 on design tasks)
  2. Task 1.1: worker wrote to claude-4-spark-1.1-results instead of muse-spark-1.1-results — corrected by orchestrator copy + removal
  3. Task 1.2: worker wrote to claude-spark-1.1-results — corrected
  4. Task 1.3: worker wrote to claude-haiku-4.5-results — corrected (also copy to target present)
  5. Task 2.2: worker wrote to claude-spark-1.1-results — corrected
  6. Task 2.3: worker wrote to claude-r-spark-1.1-results — corrected
  7. Task 3.1: initial attempt failed contamination (orchestrator auto-copy picked gpt-5.5 file) — re-ran task 3.1 clean, file now 10121 chars from muse-spark-1.1
  8. Task 3.3: re-ran after initial failure
  9. Task 5.2: worker wrote to claude-spark-1.1-results + reported auxiliary files medical_fts.py + test_medical_fts.py — py files removed when folder deleted; canonical task-5.2.md preserved (13167 chars)
  10. Task 8.2: worker wrote to claude-opus-4-6-results — corrected
  11. All tasks used fresh subagent per task, high effort prompt, no web search
  12. Final folder contains only muse-spark-1.1-results artifacts, 26 task files verified non-empty
