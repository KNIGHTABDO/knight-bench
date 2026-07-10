# KNIGHT-BENCH v1 Run Summary

- Model: `gpt-5.5`
- Requested reasoning effort: `xhigh`
- Run dates: 2026-07-09 to 2026-07-10 (Africa/Casablanca)
- Completed raw task files: 26 / 26
- Run-log entries: 26

## Operational Notes

- The available subagent interface did not expose a temperature control. Each run-log entry records `default†`; the benchmark's requested temperature settings could not be applied.
- The subagent interface did not expose hard current-folder or filesystem allowlisting controls. Every worker received the mandated sandbox text and the explicit result-folder path, but this was prompt-level containment rather than host-enforced isolation.
- Task 6.3 encountered a provider usage-limit error before any output file was written. It was retried later with the identical prompt and completed successfully.
- Task 9.1 initially could not start because completed subagent threads occupied the provider's thread limit. Completed workers were closed, then the unchanged task prompt ran successfully.

## Integrity Audit

- Confirmed all 26 expected `task-<ID>.md` files are present and no unexpected task files exist.
- Confirmed `run-log.md` contains 26 task rows.
- Searched the result bundle for prohibited benchmark-source, rubric, public-data, and peer-result path markers; no markers were found.
- Direct worker transcript/tool-log inspection and host-enforced path auditing were not available through the subagent interface.
