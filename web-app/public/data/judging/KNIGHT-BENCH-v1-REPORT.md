# KNIGHT-BENCH v1 Judge Report

Conflict statement: I am GPT-5-based Codex, not one of the tested model families named in this run (Gemini 3.5 Flash, Grok 4.5, Claude Sonnet 5). I still applied extra scrutiny to every score >=8 and did not adjust scores for perceived lab style.

Scope note: the user prompt and section 10 mention 27 tasks, but `knight-bench-v1.md` contains 26 task headings and each result folder contains 26 `task-*.md` files. I judged all official tasks present in the benchmark (78 model-task outputs) and did not invent a phantom 27th task with no prompt or rubric.

## 1. Executive Verdict

Overall winner on all provisional+final scores: **Grok 4.5** (7.767/10), ahead of Claude Sonnet 5 (7.529) and Gemini 3.5 Flash (7.208).
Winner per category: 1 Agentic coding: Gemini 3.5 Flash; 2 Medical reasoning (FR/EDN): Gemini 3.5 Flash; 3 RTL/Arabic engineering: Claude Sonnet 5; 4 Frontend design taste: Claude Sonnet 5; 5 Medical RAG/retrieval: Grok 4.5; 6 Streaming/media infra: Claude Sonnet 5; 7 Agent orchestration: Grok 4.5; 8 Long-context + IF: Grok 4.5; 9 Cost/latency: Gemini 3.5 Flash.
Personality read grounded in outputs: Gemini is concise and usually functional but more likely to miss one hard engineering edge; Grok is expansive, systems-minded, and strongest on exhaustive traps, but sometimes violates budgets; Sonnet is careful and high-taste on reasoning/design, but had several format/runnability misses.

## 2. Master Score Table

| Task | Gemini | Auto | Grok | Auto | Sonnet | Auto |
|---|---:|---:|---:|---:|---:|---:|
| 1.1 | 8 FINAL | 6/6 | 8 FINAL | 5/6 | 6 FINAL | 4/6 |
| 1.2 | 8 FINAL | 4/5 | 8 FINAL | 3/5 | 9 FINAL | 5/5 |
| 1.3 | 6 FINAL | 5/7 | 6 FINAL | 5/7 | 4 FINAL | 4/7 |
| 2.1 | 8 PROVISIONAL | 4/4 | 7 PROVISIONAL | 4/4 | 8 PROVISIONAL | 4/4 |
| 2.2 | 9 PROVISIONAL | 3/4 | 8 PROVISIONAL | 3/4 | 8 PROVISIONAL | 3/4 |
| 2.3 | 8 PROVISIONAL | 3/3 | 6 PROVISIONAL | 3/3 | 9 PROVISIONAL | 2/3 |
| 3.1 | 6 FINAL | 3/4 | 9 FINAL | 4/4 | 9 FINAL | 4/4 |
| 3.2 | 7 FINAL | 2/3 | 9 FINAL | 3/3 | 9 FINAL | 3/3 |
| 3.3 | 7 FINAL | 3/4 | 9 FINAL | 4/4 | 10 FINAL | 4/4 |
| 4.1 | 4 PROVISIONAL | 2/5 | 5 PROVISIONAL | 2/5 | 8 PROVISIONAL | 4/5 |
| 4.2 | 6 PROVISIONAL | 4/5 | 8 PROVISIONAL | 5/5 | 8 PROVISIONAL | 5/5 |
| 4.3 | 6 PROVISIONAL | 4/5 | 7 PROVISIONAL | 4/5 | 5 PROVISIONAL | 3/5 |
| 5.1 | 8 FINAL | 4/4 | 9 FINAL | 3/4 | 9 FINAL | 3/4 |
| 5.2 | 8 FINAL | 5/5 | 10 FINAL | 5/5 | 4 FINAL | 4/5 |
| 5.3 | 8 PROVISIONAL | 5/5 | 9 PROVISIONAL | 5/5 | 9 PROVISIONAL | 5/5 |
| 6.1 | 5 FINAL | 2/4 | 5 FINAL | 2/4 | 8 FINAL | 3/4 |
| 6.2 | 8 FINAL | 5/5 | 8 FINAL | 5/5 | 9 FINAL | 5/5 |
| 6.3 | 7 FINAL | 4/5 | 8 FINAL | 4/5 | 8 FINAL | 4/5 |
| 7.1 | 5 FINAL | 3/4 | 4 FINAL | 2/4 | 4 FINAL | 2/4 |
| 7.2 | 8 FINAL | 4/4 | 10 FINAL | 4/4 | 8 FINAL | 4/4 |
| 7.3 | 8 FINAL | 4/4 | 10 FINAL | 4/4 | 10 FINAL | 4/4 |
| 8.1 | 6 FINAL | 45/50 | 10 FINAL | 50/50 | 5 FINAL | 44/50 |
| 8.2 | 8 PROVISIONAL | 3/4 | 10 PROVISIONAL | 3/4 | 8 PROVISIONAL | 4/4 |
| 9.1 | 8 FINAL | 3/3 | 9 FINAL | 3/3 | 8 FINAL | 2/3 |
| 9.2 | 8 FINAL | 3/3 | 6 FINAL | 2/3 | 8 FINAL | 3/3 |
| 9.3 | 8 FINAL | 4/4 | 9 FINAL | 4/4 | 8 FINAL | 4/4 |

## 3. Category Scores

| Category | Weight | Gemini | Grok | Sonnet |
|---|---:|---:|---:|---:|
| 1. Agentic coding | 20% | 7.33 | 7.33 | 6.33 |
| 2. Medical reasoning (FR/EDN) | 20% | 8.33 | 7.00 | 8.33 |
| 3. RTL/Arabic engineering | 10% | 6.67 | 9.00 | 9.33 |
| 4. Frontend design taste | 15% | 5.33 | 6.67 | 7.00 |
| 5. Medical RAG/retrieval | 15% | 8.00 | 9.33 | 7.33 |
| 6. Streaming/media infra | 5% | 6.67 | 7.00 | 8.33 |
| 7. Agent orchestration | 10% | 7.00 | 8.00 | 7.33 |
| 8. Long-context + IF | 2.5% | 7.00 | 10.00 | 6.50 |
| 9. Cost/latency | 2.5% | 8.00 | 8.00 | 8.00 |
| **Weighted total (all scores)** | 100% | 7.208 | 7.767 | 7.529 |
| **FINAL-only normalized** | 58.75% settled | 7.220 | 8.156 | 7.255 |
| **Settled contribution to 0-10 total** | max 5.875 | 4.242 | 4.792 | 4.263 |

## 4. Head-To-Head Deep Dives

**Category 1 — Coding**  
Gemini's 1.1 is the only fully compiling Continue Watching implementation; it says `forceSaveProgress` runs on `pause`, `beforeunload`, and cleanup, and the scaffold `tsc` passed. Grok's 1.1 has stronger per-key throttle design, but the compile scaffold still reports a type-argument issue; Sonnet's 1.1 passes fewer checks and maps a Promise from `getTitles()` in the scaffold. In 1.2, Sonnet best identifies the first iOS failure: `application/octet-stream` on the native HLS manifest plus `video.src = masterUrl`; Gemini finds the bugs but ranks less cleanly, and Grok overran the <=15-line diff discipline. In 1.3 all three consolidate timers, but none uses AbortController; Sonnet also mismatches `// LINES:`.
**Category 2 — Medical (Provisional)**  
All three identify SCA ST+/IVA and the 120-minute ICP threshold. Grok's 2.1 is otherwise excellent but states `SpO₂ < 94 %`, while the key says O2 only if <90%, so I applied the medical-number penalty. In 2.2 all compute ~29.8 mL/min and choose HNF; Gemini is most compliant with units. In 2.3 Gemini and Sonnet pass the fosfomycin/no-ECBU trap cleanly, while Grok's `Alternatives 1ʳᵉ intention ... nitrofurantoïne` is the trap leakage.
**Category 3 — RTL/Arabic**  
Gemini shows real bidi knowledge but task 3.1 does not compile and 3.2 misses explicit `font-synthesis`. Grok and Sonnet both pass 3.1 grep+compile and give strong typography answers; Sonnet's Quranic text design is the strongest, explicitly saying CSS kashida is not reliable and preserving display Uthmani text separate from normalized FTS5 text.
**Category 4 — Design (Provisional)**  
Design files are blind-packed under `judging/design-review/` as A/B/C; the mapping is sealed and not repeated here. Provisionally, Sonnet has the best 4.1 art direction, while Grok/Sonnet both pass 4.2 mechanics. Gemini's 4.1 fails line count, offline/external, and RTL-root checks; Sonnet's 4.3 loses ground because the concept exceeds 120 words and demo hex colors are outside tokens.
**Category 5 — Medical RAG**  
Grok wins on 5.2: the extra `medical_fts.py` and `test_medical_fts.py` ran 15/15 OK, including IRC ambiguity and ligature tests. Gemini also ran Python tests successfully (8/8) and has a solid 5.1 pipeline. Sonnet's 5.1 is strong, but 5.2 imports `vitest` and fails `node --test`, which is fatal for a runnable-code task. In 5.3 all three catch the planted dose, ivabradine, antipneumococcal vaccine, and fluid restriction.
**Category 6 — Streaming**  
Task 6.1 separates Sonnet: it checks native `canPlayType` before hls.js, while Gemini/Grok check `Hls.isSupported()` first and hit the iOS trap. All three compile 6.2 and implement affine subtitle correction. For 6.3 all list the eight RD statuses and handle Retry-After/idempotency, but the extracted TypeScript packages do not compile cleanly as submitted modules.
**Category 7 — Agents**  
Grok dominates 7.2 with work orders, mechanical gates, risk tiers, and token metering; Sonnet is close but admits its verifier budget lands at 11.5% before adjustment. Sonnet and Grok both score 10 on the localStorage migration critique, catching sync-to-async, destructive clear, partial migration, fallback, quota/private-mode, and rollback. 7.1 punishes verbosity and lack of pre-decided conflict policy: Gemini stays under 800 words but still delegates conflict resolution too much, Grok and Sonnet exceed the cap.
**Category 8 — Long Context**  
Grok is the standout: 8.1 verified 50/50 with no compliance-table lies and 8.2 handles S6 as a partial <25 issue. Gemini gets 45/50 on 8.1 and misses S6 nuance in 8.2. Sonnet gets 44/50 on 8.1 and finds the two hard 8.2 contradictions, but dismisses S6 using only the 25-30 band.
**Category 9 — Cost/Latency**  
Grok's 9.1 is the best edited 150-word explanation and 9.3 is the best 52-word medical summary. Its 9.2 debounce function works, but 32 lines violates the 30-line budget. Gemini and Sonnet both pass the debounce behavior tests within budget; Sonnet's 9.1 is strong but over by four words.

## 5. Trap Performance

- 2.3 first-line antibiotic: Gemini and Sonnet cleanly answer fosfomycin-trometamol 3 g single dose; Grok adds nitrofurantoin as first-intention alternative and loses trap credit.
- 5.3 true-but-unsourced dose: all three correctly mark `1,25 mg/j` as NON SOUTENU.
- 8.1 constraint #29 cancellation: Grok parsed the cancellation and produced exactly one question mark; Gemini/Sonnet failed other constraints but not by adding a second question.
- 8.2 fabrication resistance: Grok best handles the S6 subtlety; Gemini and Sonnet avoid fabrications but do not fully analyze the <25 slice.
- 1.2 native-HLS-on-iOS: Sonnet states the first failure most clearly; Gemini/Grok find the native path but Gemini's auto phrase missed and Grok over-expanded fixes.

## 6. Failure Taxonomy

Common failures: hard-budget drift (Grok/Sonnet 7.1, Grok 9.2, Sonnet 9.1), incomplete runnable packaging (Sonnet 5.2; many 6.x snippets), and missing AbortController in 1.3 across all three. Exactly-one-model differentiators: Grok uniquely solves 8.1 perfectly and 5.2 with a verified full test suite; Sonnet uniquely gets 6.1 native HLS ordering right; Gemini uniquely has a fully compiling 1.1 scaffold. No obvious contamination suspicion was found: outputs use prompt terminology, but none quotes hidden rubric bands or reference-key wording in a way that suggests the benchmark file leaked.

## 7. Cost / Efficiency

All three run logs report tokens/cost as `N/A` or `n/a`; Sonnet's run log also lacks latency/cost columns beyond timestamps. Therefore no quality-per-token, quality-per-dollar, or latency-normalized ranking is computed. I did not invent token counts or prices.

## 8. Anomalies & Integrity

- Benchmark task-count inconsistency: section 10 says total cost across 27 tasks and category means over 3 tasks, but the actual file defines 26 tasks because category 8 has only 8.1 and 8.2. Scorecards therefore total 78 files, not 81.
- Gemini: temperature default/unavailable marked †; token counts N/A throughout.
- Grok: task 2.2 run log notes subagent exit code 1 / 429 after write; task 5.2 produced extra `medical_fts.py` and `test_medical_fts.py`, verified with `py -3 -m unittest test_medical_fts -v` and 15 tests OK.
- Sonnet: run log notes a task 3.1 scratchpad deviation, 7.1 word-count anomaly, and 9.2 markdown fences. No evidence in saved results that a subagent left the benchmark folder, except the self-reported scratchpad deviation.

## 9. Owner Action List

1. Open `judging/human-review/medical-review.md` and ratify all category 2, 5.3, and 8.2 provisional verdicts against current course/HAS/SPILF references.
2. Open `judging/design-review/scoring-sheet.md` and the blind `A/B/C-4.x.html` files; judge category 4 blind. Do not open `mapping-sealed.md` until after scoring.
3. After owner scores provisional items, replace provisional values in `judging/scorecards/` or the master table and recompute totals.

| Model | Current all-score total | If all provisional set to 0 | If all provisional set to 10 | Provisional swing range |
|---|---:|---:|---:|---:|
| Gemini 3.5 Flash | 7.208 | 4.242 | 8.367 | 4.242-8.367 |
| Grok 4.5 | 7.767 | 4.792 | 8.917 | 4.792-8.917 |
| Claude Sonnet 5 | 7.529 | 4.263 | 8.388 | 4.263-8.388 |