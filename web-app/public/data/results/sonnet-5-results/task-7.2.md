# Multi-Agent Orchestration: French Medical PDF Corpus Pipeline (10-80-10 Pattern)

## 0. Framing and assumptions (stated explicitly, since some numbers are estimates)

The workload: 120 French medical course PDFs (e.g. "items" from the French national medical curriculum — ECN/EDN style, each tagged with an "item number," a specialty, and a section hierarchy) must be converted into a clean, chunked, metadata-tagged SQLite corpus for retrieval-augmented generation.

Constraint: across the whole job, the frontier (expensive) model may consume at most 10% of total tokens on planning (start) and 10% on review (end). The remaining 80% of tokens must be spent on a cheap model doing the actual per-document extraction/chunking work. This is the "10-80-10" pattern.

I do not have access to the actual PDFs, so page counts, exact token-per-page ratios, and the true rate of OCR/extraction defects are estimates based on typical PDF-to-text token densities (roughly 400-700 tokens per page of dense academic French text, plus PDF text-extraction overhead). I flag every such estimate below rather than presenting it as measured fact. The token-math table in section 5 is a budget model, not a benchmark result — it should be recalibrated after a pilot batch of 3-5 real PDFs before committing the full budget.

---

## 1. Role specification

### 1.1 Planner (frontier model, runs once at start, ≤10% of total token budget)

**Responsibilities:**
- Read a small representative sample of the corpus (not all 120 PDFs — see 1.1.1) to characterize document structure: how item numbers are printed (e.g. "Item 245", "UE 8 — Item 245", "N°245"), how specialties are labeled or must be inferred from item-number lookup tables, how section headings are typographically distinguished (font-weight cues lost in plain text extraction, numbering schemes like "I.", "1.", "A.", bullet nesting), and how noise appears (running headers/footers, page numbers, figure captions, references).
- Produce the **canonical item-number → specialty mapping table** (the official French EDN program has a fixed, enumerable mapping of item numbers to specialties/UEs — this should be sourced once, as a static lookup table, not re-derived per PDF by a cheap model doing guesswork).
- Design and freeze the **SQLite schema** (tables, columns, types, foreign keys, indices) for documents, sections, and chunks.
- Design and freeze the **work-order template** (see section 2) that every executor will receive — this is the single most important artifact, because it is what makes a cheap model reliable.
- Design the **mechanical validation rules** (regexes, count checks, schema constraints) that will gate executor output before it reaches the verifier (see section 3) — written as code/config, not as prose instructions to be reinterpreted.
- Design the **verifier's sampling and escalation policy** (see section 4).
- Triage the 120 PDFs into a small number of **structural clusters** (e.g. "single-column lecture notes," "two-column slide-deck export," "scanned/OCR'd," "multi-item combined PDF") based on a light scan (file size, page count, a cheap-model or programmatic pass extracting the first/last page text) — each cluster gets its own work-order variant/parameter set, decided once by the planner rather than re-decided by every executor.

**Inputs:** 3-6 sample PDFs (chosen to span the visible structural variety — e.g. by inspecting file sizes/page counts/producer metadata cheaply first), the official item-number/specialty reference list (if available as a document, otherwise the planner constructs it from domain knowledge and flags it as needing human confirmation), and the target SQLite schema requirements from the requester.

**Outputs (artifacts):**
1. `schema.sql` — frozen SQLite DDL.
2. `item_specialty_map.json` — canonical item→specialty lookup.
3. `work_order_template.json` (+ filled examples per cluster) — the executor contract.
4. `validation_rules.yaml` — the mechanical (non-LLM) checks executors' outputs must pass, expressed as regex/schema/count assertions.
5. `pdf_cluster_assignment.csv` — which of the 120 PDFs falls into which structural cluster, and which work-order variant applies.
6. `sampling_policy.md` — the verifier's risk-weighted sampling plan with numbers (section 4).

**1.1.1 Why the planner does not read all 120 PDFs:** at 10% of budget it structurally cannot — reading even a skimmed pass of 120 dense PDFs at frontier-model rates would blow the ceiling by itself (see token math). The planner's job is to design the *process*, not process the *documents*. It reads enough to generalize the format, not enough to have "seen" every document.

### 1.2 Executors (cheap model, N parallel workers, 80% of total token budget, one PDF each — or a few each, sequentially)

**Responsibilities (per PDF, per the work order it receives):**
- Extract raw text from the PDF (via a deterministic, non-LLM text-extraction library called by the executor's tool harness — the cheap model does not "read" the PDF pixel-by-pixel; it operates on pre-extracted text/markdown handed to it, which keeps its token cost low and its job well-defined).
- Identify the item number and specialty using the rules given in the work order (regex patterns supplied by the planner, plus the frozen lookup table — the executor should almost never need to "reason" about specialty; it looks it up).
- Segment the document into the section hierarchy (chapter/heading/subheading) following the heading-detection rules in the work order.
- Chunk the section content according to the fixed chunking parameters in the work order (target chunk size, overlap, never-split-mid-sentence rule, never-split-a-table rule).
- Tag each chunk with metadata: item number, specialty, section path (e.g. `["Item 245", "II. Diagnostic", "B. Examens complémentaires"]`), page range, source filename.
- Emit output in the **exact** structured format specified by the work order (a JSON array of chunk records) — no prose, no commentary, no deviation.
- Run its own **self-check** against a short mechanical checklist embedded in the work order (count of chunks > 0, every chunk has non-empty section_path, item_number matches the regex in the work order) before returning — this is still "cheap," since it's the executor re-reading its own structured output, not an LLM judgment call.

**Inputs:** one PDF's extracted text (or markdown, pre-extracted deterministically), the filled work order for that PDF (or its cluster), the frozen item→specialty table, the frozen SQLite schema fragment relevant to what it must produce.

**Outputs (artifacts):** one `chunks_<item_number>.json` file per PDF (array of chunk records matching the work-order schema), plus one `extraction_log_<item_number>.json` recording self-check results and any fields the executor could not confidently fill (flagged `null` with a `reason` string rather than guessed).

**N:** one executor invocation per PDF is the simplest mental model (120 invocations), though in practice several PDFs can be processed by the same worker sequentially to amortize setup; concurrency (how many run at once) is an infrastructure choice independent of the token-budget math, since token cost is per-invocation, not per-wall-clock-time. I will describe the design as "120 executor jobs," parallelism aside.

### 1.3 Verifier (frontier model, runs once at end, ≤10% of total token budget)

**Responsibilities:**
- Ingest the **outputs of the mechanical validation layer** (section 3), not raw executor output directly — i.e., the verifier's first input is a triage report ranking all 120 PDFs by risk score, not 120 raw JSON files.
- Apply the risk-weighted sampling policy (section 4) to select a small subset of PDFs/chunks for actual close reading.
- For sampled items: compare executor output against the source text for item-number correctness, specialty correctness, section-hierarchy sanity, and chunk-boundary sanity.
- For flagged/failed mechanical checks (section 3) that fall outside the verifier's direct sample but were auto-escalated: adjudicate them specifically (this is a bounded, cheap-per-item task since the mechanical layer already narrowed down *where* the problem is).
- Produce a final **QA report** and a **corpus acceptance decision** (accept as-is / accept with N flagged records excluded / reject and re-run cluster X).
- If verifier finds a **systematic** error (e.g., every PDF in cluster "two-column slide export" has section hierarchy off by one level), it does not attempt to hand-fix all affected PDFs itself (that would blow the 10% budget) — it writes a **targeted re-work order** (a small patch to the original work order) and flags the affected PDF list for a second, narrow executor pass, which itself stays inside the 80% middle budget conceptually (or is treated as a small addendum — see 5.4).

**Inputs:** `validation_report.csv` (mechanical layer output, all 120 rows, risk-scored), the sampling policy, the sampled executor JSON outputs plus their corresponding source PDF text, the frozen schema and item-specialty table (to check against, not re-derive).

**Outputs (artifacts):**
1. `qa_report.md` — per-sample findings, error taxonomy, estimated corpus-wide error rate with confidence bounds.
2. `acceptance_decision.json` — accept/reject per cluster or per flagged PDF.
3. `rework_orders/*.json` — targeted patches for systematic issues, if any, to be run by executors (not the verifier).
4. Final `corpus.sqlite` sign-off note appended to the SQLite database itself (a `_pipeline_meta` table row recording verifier pass, sample size, error rate, date).

---

## 2. Planner's work-order schema (the executor contract)

The design goal: a cheap/weak model should not need to make a single unconstrained judgment call. Every field either has a mechanical extraction rule (regex/lookup) or a strictly bounded decision (pick from an enumerated list, or say "uncertain" and flag it — never guess and assert).

### 2.1 Work order JSON schema (template, given to every executor)

```json
{
  "work_order_version": "1.0",
  "pdf_id": "<string, source filename stem>",
  "cluster": "<enum: single_column | two_column_slides | scanned_ocr | multi_item_combined>",

  "item_number_extraction": {
    "method": "regex_first_match",
    "patterns": [
      "(?i)item\\s*n?°?\\s*(\\d{1,3})",
      "(?i)UE\\s*\\d+\\s*[-–—]\\s*item\\s*(\\d{1,3})",
      "(?i)N°\\s*(\\d{1,3})"
    ],
    "search_scope": "first_2_pages",
    "on_no_match": "set item_number=null, flag='ITEM_NUMBER_NOT_FOUND', do_not_guess"
  },

  "specialty_lookup": {
    "method": "table_lookup",
    "table_ref": "item_specialty_map.json",
    "key": "item_number",
    "on_key_missing": "set specialty=null, flag='SPECIALTY_LOOKUP_MISS', do_not_guess"
  },

  "section_hierarchy_rules": {
    "heading_detection": [
      {"level": 1, "pattern": "^[IVX]+\\.\\s+.+$", "example": "II. Diagnostic"},
      {"level": 2, "pattern": "^[A-Z]\\.\\s+.+$", "example": "B. Examens complémentaires"},
      {"level": 3, "pattern": "^\\d+\\.\\s+.+$", "example": "3. Biologie"}
    ],
    "max_depth": 3,
    "on_ambiguous_heading": "assign to nearest_matching_level, flag='HEADING_AMBIGUOUS'",
    "on_no_headings_found": "assign single section_path=['UNSTRUCTURED'], flag='NO_HEADINGS_DETECTED'"
  },

  "chunking_rules": {
    "target_tokens": 400,
    "max_tokens": 600,
    "overlap_tokens": 50,
    "never_split": ["table", "numbered_list", "sentence"],
    "chunk_id_format": "{item_number}_{section_index}_{chunk_index}"
  },

  "output_schema": {
    "type": "array",
    "item_fields": {
      "chunk_id": "string, required",
      "item_number": "string|null, required",
      "specialty": "string|null, required",
      "section_path": "array[string], required, min 1 element",
      "page_start": "integer, required",
      "page_end": "integer, required",
      "text": "string, required, non-empty",
      "flags": "array[string], optional"
    }
  },

  "self_check_before_return": [
    "chunk_count > 0",
    "every chunk.section_path is non-empty array",
    "every chunk.text length between 50 and 3000 chars",
    "if item_number extraction flagged ITEM_NUMBER_NOT_FOUND, every chunk.item_number is null (not invented)",
    "chunk_ids are unique within this file"
  ],

  "explicit_prohibitions": [
    "Do not invent an item_number if none is found by the regex.",
    "Do not invent a specialty if the item_number is not in the lookup table.",
    "Do not translate, summarize, or paraphrase source text — extract verbatim.",
    "Do not merge two source pages' text into one chunk if a heading boundary falls between them.",
    "Do not output anything other than the JSON array — no explanations, no markdown fences."
  ]
}
```

### 2.2 Filled example for one PDF

Assume the PDF is `item245_diabete.pdf`, a single-column lecture-note document, 6 pages, on "Item 245 — Diabète sucré de types 1 et 2".

```json
{
  "work_order_version": "1.0",
  "pdf_id": "item245_diabete",
  "cluster": "single_column",

  "item_number_extraction": {
    "method": "regex_first_match",
    "patterns": [
      "(?i)item\\s*n?°?\\s*(\\d{1,3})",
      "(?i)UE\\s*\\d+\\s*[-–—]\\s*item\\s*(\\d{1,3})",
      "(?i)N°\\s*(\\d{1,3})"
    ],
    "search_scope": "first_2_pages",
    "on_no_match": "set item_number=null, flag='ITEM_NUMBER_NOT_FOUND', do_not_guess",
    "matched_value_for_this_pdf": "245"
  },

  "specialty_lookup": {
    "method": "table_lookup",
    "table_ref": "item_specialty_map.json",
    "key": "245",
    "on_key_missing": "set specialty=null, flag='SPECIALTY_LOOKUP_MISS', do_not_guess",
    "resolved_value_for_this_pdf": "Endocrinologie-Diabétologie-Nutrition"
  },

  "section_hierarchy_rules": {
    "heading_detection": [
      {"level": 1, "pattern": "^[IVX]+\\.\\s+.+$", "example": "II. Diagnostic"},
      {"level": 2, "pattern": "^[A-Z]\\.\\s+.+$", "example": "B. Examens complémentaires"},
      {"level": 3, "pattern": "^\\d+\\.\\s+.+$", "example": "3. Biologie"}
    ],
    "max_depth": 3,
    "on_ambiguous_heading": "assign to nearest_matching_level, flag='HEADING_AMBIGUOUS'",
    "on_no_headings_found": "assign single section_path=['UNSTRUCTURED'], flag='NO_HEADINGS_DETECTED'"
  },

  "chunking_rules": {
    "target_tokens": 400,
    "max_tokens": 600,
    "overlap_tokens": 50,
    "never_split": ["table", "numbered_list", "sentence"],
    "chunk_id_format": "245_{section_index}_{chunk_index}"
  },

  "output_schema": { "...(same as template, unchanged)": "..." },

  "self_check_before_return": [ "...(same as template, unchanged)..." ],

  "explicit_prohibitions": [ "...(same as template, unchanged)..." ]
}
```

Expected (illustrative, not guaranteed) executor output for the first two chunks:

```json
[
  {
    "chunk_id": "245_1_1",
    "item_number": "245",
    "specialty": "Endocrinologie-Diabétologie-Nutrition",
    "section_path": ["I. Épidémiologie et physiopathologie"],
    "page_start": 1,
    "page_end": 1,
    "text": "Le diabète de type 2 représente environ 90% des cas de diabète en France...",
    "flags": []
  },
  {
    "chunk_id": "245_2_1",
    "item_number": "245",
    "specialty": "Endocrinologie-Diabétologie-Nutrition",
    "section_path": ["II. Diagnostic", "A. Critères diagnostiques"],
    "page_start": 2,
    "page_end": 2,
    "text": "Le diagnostic repose sur une glycémie à jeun ≥ 1,26 g/L (7,0 mmol/L) vérifiée à deux reprises...",
    "flags": []
  }
]
```

This is deliberately mechanical: the executor's only "judgment" is matching text against pre-supplied regexes/enums and following fixed chunk-size arithmetic — exactly the kind of task a cheap model handles reliably, because there is no open-ended reasoning step.

---

## 3. Where the 80% goes wrong: 4 likely cheap-model failure modes and their mechanical catches

I am flagging this whole section as **predicted, not measured** — these are the standard failure modes for this class of extraction task based on how weak/cheap models behave on structured-extraction workloads, not findings from having run this specific pipeline.

**1. Hallucinated or misattributed item numbers** (executor invents "Item 245" when the regex found nothing, or pattern-matches the wrong number from a cross-reference in the body text rather than the title).
- *Mechanical catch:* (a) Regex re-validation — independently re-run the same item-number regex against the source text outside the LLM call and diff it against what the executor emitted; any mismatch is an automatic hard fail, no LLM needed. (b) Cross-check every `item_number` value against the enumerable universe of valid EDN item numbers (a fixed integer set, e.g. 1-367) — any value outside that set is rejected by a simple set-membership check. (c) Check that `item_number` is **constant across every chunk in the file** (a single PDF should have one item number, with rare documented exceptions for multi-item PDFs) — any file with >1 distinct non-null item_number values across its chunks is auto-flagged.

**2. Section-hierarchy drift** (executor's `section_path` values stop reflecting the real document structure partway through — e.g., it keeps reusing "II. Diagnostic" for content that has moved into "III. Traitement," or nesting depth silently increases/decreases without a matching heading in the source).
- *Mechanical catch:* (a) Monotonicity/ordering check — walk the chunk sequence in page order and verify that `section_path` transitions only occur at points where the extracted source text actually contains a heading-pattern match (re-run the heading regex independently against source text at each chunk boundary and require agreement). (b) Depth-jump check — flag any transition where hierarchy depth changes by more than 1 level in a single step (e.g., level-1 to level-3 with no level-2 in between) as a schema violation. (c) Distinct-section-path count vs. detected-heading count — programmatically count regex heading matches in the raw source text and compare to the count of distinct `section_path` values in the output; large discrepancies (e.g., >20% difference) auto-flag the file.

**3. Chunk-boundary violations / lost or duplicated content** (executor split mid-sentence, split a table, dropped a page's worth of text, or emitted overlapping chunks that duplicate large spans, silently corrupting retrieval).
- *Mechanical catch:* (a) Reconstruction check — concatenate all chunks' `text` fields (minus declared overlap) in order and diff total character count against the source-extracted text's character count; a delta beyond a small tolerance (e.g., ±5%) auto-fails the file for missing/duplicated content. (b) Sentence-boundary check — regex-verify that no chunk both starts mid-word (lowercase first character with no leading punctuation context) and is not a declared overlap-continuation; flag violations. (c) Chunk-size distribution check — every chunk's token count (computed with a cheap deterministic tokenizer, not an LLM) must fall within `[target_tokens - overlap, max_tokens]`; anything outside is a schema violation, not a judgment call.

**4. Specialty mis-tagging via lookup bypass** (executor ignores the frozen `item_specialty_map.json` and infers a specialty from context instead — plausible-sounding but wrong, e.g., tagging a diabetes item as "Cardiologie" because the chunk discusses cardiovascular complications).
- *Mechanical catch:* (a) Hard join check — for every chunk, deterministically re-look-up `specialty` from `item_specialty_map.json` using the chunk's `item_number` and assert exact string equality with the executor's emitted `specialty`; this requires zero LLM involvement and catches 100% of lookup-bypass errors by construction. (b) Enum-membership check — `specialty` must be one of the fixed, finite list of official EDN specialty names; any value not in that closed list is an automatic reject (catches free-text invention even if the item-number lookup was somehow also wrong).

All four checks above are implementable as plain code (regex, set/enum membership, arithmetic diffs, deterministic tokenization) run against the executor's JSON output and the independently-extracted source text — none of them require an LLM call, which is exactly why they can sit between the 80% and the 10% without eating into either budget.

---

## 4. Verifier's sampling strategy (risk-weighted, with numbers)

The verifier cannot read all 120 PDFs at 10% of total budget (see math in section 5 — full-document frontier review of all 120 would alone consume roughly 4-8x the entire allotted review budget). It must sample.

**Step 1 — Triage by the mechanical layer (free, already computed in section 3):** every one of the 120 PDFs gets a `risk_score` from the validation layer, e.g.:
- `risk_score = 0` — passed all mechanical checks cleanly.
- `risk_score = 1` (low) — passed, but had ≥1 soft flag (e.g., `HEADING_AMBIGUOUS` on a single chunk).
- `risk_score = 2` (medium) — passed but had a borderline metric (e.g., chunk-size distribution within tolerance but near the boundary, or reconstruction delta 3-5%).
- `risk_score = 3` (high) — failed at least one hard mechanical check (item-number mismatch, specialty lookup mismatch, section monotonicity violation, reconstruction delta >5%).

**Step 2 — Mandatory escalation (no sampling, 100% coverage, cheap):** every `risk_score = 3` PDF is automatically routed to the verifier — these are not sampled, they are guaranteed review, because a hard mechanical failure means the executor's output is already known-bad and needs a human-grade call on whether it's salvageable or must be re-run. Expect this to be a small minority if the work order (section 2) is well-designed — budgeting for up to 12 PDFs (10% of 120) in this bucket is a reasonable planning ceiling; if the actual rate is higher, that itself is a signal to stop and fix the work order/executor prompt rather than let the verifier absorb it.

**Step 3 — Stratified random sampling of the rest:** from the remaining pool (risk_score 0-2), sample:
- 100% is infeasible; sample proportionally weighted toward risk:
  - `risk_score = 2` pool: sample 40% (rounded up), minimum 3 PDFs.
  - `risk_score = 1` pool: sample 15% (rounded up), minimum 2 PDFs.
  - `risk_score = 0` pool: sample a flat 10%, minimum 3 PDFs — a clean-pass file can still hide an error the mechanical checks don't cover (e.g., correct schema but semantically wrong section title), so zero-risk files are never fully exempted.
- Additionally, **stratify by cluster** (from section 1.1's structural clustering) so every cluster (single_column, two_column_slides, scanned_ocr, multi_item_combined) gets at least 2 sampled PDFs regardless of its risk distribution — a systematic bug tends to be cluster-specific, and pure risk-weighting could miss a cluster that fails "cleanly" (i.e., passes shallow mechanical checks but is wrong in a way the checks don't catch).

**Worked numeric example (illustrative distribution):** if the 120 PDFs shake out as 8 at risk 3, 20 at risk 2, 40 at risk 1, 52 at risk 0:
- Risk 3: 8 reviewed (100%, mandatory).
- Risk 2: ceil(20 × 0.40) = 8 reviewed.
- Risk 1: ceil(40 × 0.15) = 6 reviewed.
- Risk 0: max(ceil(52 × 0.10), 3) = 6 reviewed.
- Cluster top-up: assume clusters are already well-represented above; add up to 4 more PDFs if any cluster has <2 samples.
- **Total verifier sample ≈ 28-32 PDFs (about 23-27% of the corpus by file count)**, but importantly the verifier is not doing full-document close reads of all 32 — for risk 0/1 items it does a fast targeted check (confirm item number, specialty, and spot-check 2-3 chunk boundaries) rather than the deep read given to risk-3 items. This keeps the *effective* token cost far below "32 full documents" — see section 5.4.

**Step 4 — Escalation-on-pattern rule:** if the verifier finds ≥2 independent errors of the *same type* (e.g., section-drift) within its sample, it does not keep sampling one-by-one — it declares the responsible cluster/work-order-variant systematically defective, pulls every remaining PDF in that cluster into mandatory review, and issues a rework order (section 1.3) rather than trying to individually adjudicate each one inside its own budget. This bounds worst-case verifier cost: a systematic bug triggers a structural fix (re-run executors, which is a cheap-model cost) rather than the frontier model manually fixing 40 files one at a time.

---

## 5. Token math: budget table proving the 10-80-10 split

**Caveat up front:** the token-per-page and token-per-PDF figures below are estimates based on typical dense-text academic PDF extraction (roughly 500-650 words per page of French medical text, ~1.3-1.5 tokens per word for French, plus structural/JSON overhead). I have not measured this against the actual 120 PDFs. Treat this table as the budget *model* to validate against a 3-5 PDF pilot before committing real spend — if the pilot shows materially different token densities, the split still holds by design (the policy fixes the *percentage*, not the *dollar amount*, so it self-scales), but the absolute totals below would need updating.

**Assumptions for this table:** average PDF = 10 pages; extracted source text ≈ 550 tokens/page ≈ 5,500 tokens/PDF; executor input includes source text + work order (~600 tokens fixed) + schema/lookup table reference (~300 tokens, cacheable across the run); executor output ≈ 1,800 tokens (chunked JSON, roughly 12-18 chunks × ~120 tokens each including metadata overhead).

| Stage | Model | Unit cost (tokens) | Count | Stage total (tokens) |
|---|---|---|---|---|
| **Planner** | Frontier | | | |
| — read 5 sample PDFs (in+out) | | ~6,500 in + 800 out per PDF | 5 | 36,500 |
| — design schema, work order, validation rules, sampling policy (reasoning + output) | | ~15,000 | 1 | 15,000 |
| — build item↔specialty table + cluster assignment pass (light scan of 120 filenames/metadata, not full reads) | | ~50 tokens/PDF × 120 | 120 | 6,000 |
| **Planner subtotal** | | | | **57,500** |
| **Executors** | Cheap | | | |
| — per PDF: input (source text 5,500 + work order 600 + lookup ref 300) + output (1,800) + self-check overhead (~200) | | ~8,400 | 120 | 1,008,000 |
| **Executor subtotal** | | | | **1,008,000** |
| **Mechanical validation layer** | (no LLM — code) | 0 tokens | 120 | 0 |
| **Verifier** | Frontier | | | |
| — mandatory risk-3 deep review (in: source text 5,500 + executor output 1,800; out: findings ~400) | | ~7,700 | 8 | 61,600 |
| — sampled fast-check review (in: executor output only, 1,800 + targeted source excerpt ~1,000; out: ~200) | | ~3,000 | 24 | 72,000 |
| — final QA report + acceptance decision synthesis | | ~5,000 | 1 | 5,000 |
| **Verifier subtotal** | | | | **138,600** |
| **Grand total** | | | | **1,204,100** |

**Percentage check:**
- Planner: 57,500 / 1,204,100 ≈ **4.8%**
- Executors: 1,008,000 / 1,204,100 ≈ **83.7%**
- Verifier: 138,600 / 1,204,100 ≈ **11.5%**

This lands close to 10-80-10 but the verifier is slightly over budget (11.5% vs. 10% ceiling) in this illustrative model, and the planner has headroom (4.8% vs. 10%). Two acceptable ways to true this up, both mechanical, no re-negotiation of scope needed:
1. Shift ~2-3% of budget from planner's unused headroom to verifier explicitly (the 10-80-10 split is a policy on the *combined* frontier allocation being ≤20% total with a soft internal 10/10 target, not two hard-walled silos — if the organization wants strict independent 10% ceilings, tighten the sample size in section 4, e.g. drop the risk-0 minimum from 6 to 3 PDFs and the risk-1 rate from 15% to 10%, which removes roughly 10,000-12,000 tokens from the verifier subtotal).
2. Increase the mechanical validation layer's coverage (free, since it's code) so fewer files land in risk_score 2-3, shrinking the verifier's mandatory-review pool over time — this is the lever that scales best, since it moves cost from frontier tokens to zero-cost code.

**Sensitivity note:** the dominant term in the whole budget is `executor_input_per_PDF × 120`, and within that, source-text tokens (5,500 of the ~8,400) dominate. Two things would materially change the ratio if real PDFs differ from the 10-page assumption: (a) longer PDFs (some medical course PDFs run 20-30+ pages) would inflate the executor subtotal roughly linearly, which *strengthens* the 10-80-10 compliance on the percentage basis (executors get relatively bigger, planner/verifier stay flat since they don't scale with PDF length in the same way) but raises the absolute dollar cost; (b) if source text must be included in full in every verifier sample review (rather than a targeted excerpt), the verifier subtotal could roughly double, breaking the 10% ceiling — this is why section 4's "fast-check" review deliberately avoids full-document re-reads for anything below risk_score 3.

---

## 6. Summary of the control mechanism

The 10-80-10 split is enforced by design, not by hoping the cheap model behaves: the planner spends its budget on artifacts (schema, work order, validation rules, sampling policy) that are reusable across all 120 PDFs rather than per-document reasoning; the executors spend their budget on mechanical, tightly-scoped extraction against those artifacts; a zero-token code layer (regex/enum/count checks) filters executor output before any frontier tokens are spent reviewing it; and the verifier spends its budget on a risk-weighted sample plus mandatory review of anything the free mechanical layer already proved is broken, escalating to a structural rework order rather than manually patching files one at a time when it detects a systematic failure. The main dependency the whole design rests on is the quality of the work order and the mechanical validation rules produced in the planning phase — if those are underspecified, the cheap-model failure rate rises, the mandatory-escalation pool grows, and the verifier's budget is the first thing to blow past 10%, which is also why it functions as a real (not just symbolic) circuit breaker on the whole pipeline's reliability.
