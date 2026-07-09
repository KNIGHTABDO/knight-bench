# Task 7.2 — Multi-Agent Orchestration: French Medical PDF → SQLite RAG Corpus (10-80-10)

**Workload:** Convert **120 French medical course PDFs** into a clean, chunked, metadata-tagged **SQLite** corpus (item numbers, specialties, section hierarchy) for RAG.  
**Budget constraint:** Frontier model ≤ **10%** of total tokens at start (planning) + ≤ **10%** at end (review). Middle **80%** must run on a cheap model.  
**Pattern name:** 10-80-10.

---

## 1. Role Specification for Each Agent

### 1.1 Planner (Frontier model) — 10% budget, start only

| Field | Specification |
|--------|----------------|
| **Count** | 1 (serial, once per batch / corpus campaign) |
| **Model tier** | Expensive frontier |
| **When it runs** | Once at corpus start (plus optional micro-replans only on structural schema change — still charged to planner budget) |
| **Exact responsibilities** | (1) Inventory all 120 PDFs and derive a stable `doc_id`. (2) Infer document-level metadata templates (specialty taxonomy, French ECN/EDN item-number conventions, expected section patterns). (3) Design the SQLite schema, chunking policy, and JSON Schemas for all intermediate artifacts. (4) Emit one **work order per PDF** so unambiguous that a weak model can follow it without improvisation. (5) Emit global constants: specialty allow-list, item-number regex, heading patterns, chunk size/overlap, language rules (French preserved, no translation). (6) Define mechanical gate specs and risk tiers used later by the orchestrator and verifier. |
| **Inputs** | File list of 120 PDFs (paths, sizes, page counts if available); sample page text from ~5–10 representative PDFs (deterministic extract, not LLM); optional curriculum maps (specialties, item lists) if present on disk; target SQLite schema goals. |
| **Outputs / artifacts** | `corpus_plan.json` (global schema + policies); `work_orders/{doc_id}.json` × 120; `taxonomy/specialties.json`; `taxonomy/item_number_rules.json`; `gates/mechanical_checks.yaml`; `risk_tiers.csv` (initial risk score per PDF); empty/skeleton `corpus.sqlite` with tables and constraints. |
| **Must not do** | Full-body extraction of all 120 PDFs; chunk writing; mass verification. |

### 1.2 Executors (Cheap model) — 80% budget, middle

| Field | Specification |
|--------|----------------|
| **Count N** | **N = 8–12 parallel workers** recommended (I/O-bound PDF parse + LLM extract); orchestrator assigns one work order at a time per worker. **Logical executor types** below; same cheap model, different prompts/tools. |
| **Model tier** | Cheap / small instruction model only |
| **When they run** | For every PDF, in a fixed pipeline of stages; retries stay on cheap model until mechanical gates fail max times → escalate. |

#### Executor roles (cheap)

| Agent ID | Role name | Exact responsibilities | Inputs | Outputs / artifacts |
|----------|-----------|------------------------|--------|---------------------|
| **E0** | **PDF Ingestor** (mostly non-LLM tools; cheap model only for layout repair notes) | Run deterministic PDF→text/structure (pypdf/pdfplumber/pymupdf). Normalize whitespace, page breaks, headers/footers via work-order rules. Produce page-aligned raw text. | Work order + PDF path | `raw/{doc_id}/pages.jsonl` (page_no, text, char_count); `raw/{doc_id}/ingest_report.json` |
| **E1** | **Structure Extractor** | Tag section hierarchy (H1/H2/H3…), detect item numbers (*items* ECN/EDN), map specialties from allow-list, detect TOC vs body. Follow work-order regexes and heading rules **exactly**. | Work order + `pages.jsonl` | `struct/{doc_id}/sections.json` (tree); `struct/{doc_id}/items.json`; `struct/{doc_id}/specialties.json` |
| **E2** | **Chunker** | Slice body text into chunks per work-order policy (token/char targets, overlap, never split mid-table if flagged). Attach metadata: `doc_id`, `item_numbers[]`, `specialty`, `section_path[]`, `page_start`, `page_end`, `chunk_index`. | Work order + sections + pages | `chunks/{doc_id}/chunks.jsonl` |
| **E3** | **SQLite Writer** | Validate each chunk against JSON Schema; INSERT into SQLite in a transaction per PDF; write idempotent upserts keyed by `(doc_id, chunk_index)`. | Work order + chunks + DB path | Rows in `corpus.sqlite`; `load/{doc_id}/write_receipt.json` (row counts, hashes) |
| **E4** | **Self-repair loop (cheap)** | On mechanical gate failure only: re-run the failing stage with the **gate error string** as hard constraints (no freeform “improve quality”). Max **2** cheap retries per stage. | Gate failure report + prior artifact | Revised artifact + `retries/{doc_id}/attempt_k.json` |

**Shared executor constraints**
- No invention of item numbers not matching work-order regex **and** present in source text.
- No specialty labels outside `specialties.json` allow-list (map to `UNKNOWN` + flag).
- No translation of French clinical text.
- No calls to frontier model.

### 1.3 Verifier (Frontier model) — 10% budget, end (and rare escalations)

| Field | Specification |
|--------|----------------|
| **Count** | 1 (or thin pool), budget-capped |
| **Model tier** | Expensive frontier |
| **Exact responsibilities** | (1) Risk-weighted sample of PDFs/chunks for semantic correctness (item–content alignment, hierarchy fidelity, specialty fit, chunk coherence). (2) Adjudicate **escalated** PDFs that failed mechanical gates after cheap retries. (3) Issue **repair work orders** (narrow diffs) for cheap executors when fixable; quarantine unfixable docs. (4) Emit final acceptance report and freeze corpus version. |
| **Inputs** | Sampled artifacts (`sections`, `chunks`, random page excerpts); full artifacts for escalations; mechanical gate logs; risk scores; SQLite aggregate stats. |
| **Outputs / artifacts** | `review/{doc_id}/verdict.json` (pass / repair / reject); `review/repair_orders/{doc_id}.json` (if needed); `review/corpus_acceptance.json`; optional `review/gold_notes.md` for future regression tests. |
| **Must not do** | Re-process all 120 PDFs end-to-end; rewrite the global schema unless critical. |

### 1.4 Orchestrator (non-LLM, deterministic control plane)

Not an LLM agent, but required for the pattern to hold:

- Schedules work orders → E0→E1→E2→E3.
- Runs **mechanical gates** after each stage (Section 3).
- Manages retries, risk scores, and escalation queue to Verifier.
- Tracks token meters separately for frontier vs cheap so 10-80-10 is enforceable.

---

## 2. Planner’s Work-Order Schema (Unambiguous for Weak Models)

### 2.1 Design principles

1. **Closed vocabularies** — specialties, section types, chunk strategies as enums.
2. **Explicit regexes and examples** — no “find items if any.”
3. **Page-scoped instructions** — tell the model *where* to look.
4. **Copy-or-null** — fields are either extracted substrings from source or `null` / `UNKNOWN`; never paraphrase for metadata keys.
5. **Hard limits** — max sections, max items, chunk char ranges.
6. **Machine-checkable success criteria** — every instruction maps to a gate.

### 2.2 JSON Schema (logical fields)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MedicalPDFWorkOrder",
  "type": "object",
  "required": [
    "work_order_id", "doc_id", "pdf_path", "language", "pipeline",
    "taxonomy", "extraction_rules", "chunking", "sqlite", "success_criteria",
    "forbidden_behaviors", "output_paths"
  ],
  "properties": {
    "work_order_id": { "type": "string" },
    "doc_id": { "type": "string", "pattern": "^DOC-[0-9]{3}$" },
    "pdf_path": { "type": "string" },
    "language": { "const": "fr" },
    "risk_tier": { "enum": ["LOW", "MED", "HIGH"] },
    "source_profile": {
      "type": "object",
      "properties": {
        "approx_pages": { "type": "integer" },
        "layout": { "enum": ["single_column", "two_column", "slides", "mixed", "unknown"] },
        "has_toc": { "type": "boolean" },
        "encoding_notes": { "type": "string" }
      }
    },
    "pipeline": {
      "type": "array",
      "items": { "enum": ["INGEST", "STRUCTURE", "CHUNK", "WRITE_SQLITE", "MECHANICAL_GATES"] }
    },
    "taxonomy": {
      "type": "object",
      "required": ["specialty_allowlist", "default_specialty", "item_number_regex"],
      "properties": {
        "specialty_allowlist": { "type": "array", "items": { "type": "string" } },
        "default_specialty": { "type": "string" },
        "item_number_regex": { "type": "string" },
        "item_number_examples_valid": { "type": "array", "items": { "type": "string" } },
        "item_number_examples_invalid": { "type": "array", "items": { "type": "string" } }
      }
    },
    "extraction_rules": {
      "type": "object",
      "required": ["heading_patterns", "hierarchy_rules", "item_binding_rules", "header_footer_strip"],
      "properties": {
        "header_footer_strip": {
          "type": "object",
          "properties": {
            "strip_lines_matching": { "type": "array", "items": { "type": "string" } },
            "max_header_lines": { "type": "integer" },
            "max_footer_lines": { "type": "integer" }
          }
        },
        "heading_patterns": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["level", "regex", "example"],
            "properties": {
              "level": { "type": "integer", "minimum": 1, "maximum": 4 },
              "regex": { "type": "string" },
              "example": { "type": "string" }
            }
          }
        },
        "hierarchy_rules": {
          "type": "object",
          "properties": {
            "max_depth": { "type": "integer" },
            "no_skip_levels": { "type": "boolean" },
            "section_id_format": { "type": "string" },
            "path_join": { "const": " > " }
          }
        },
        "item_binding_rules": {
          "type": "object",
          "properties": {
            "scan_pages": { "enum": ["all", "first_n", "toc_and_titles"] },
            "first_n_pages": { "type": "integer" },
            "bind_scope": { "enum": ["document", "section", "chunk"] },
            "require_match_in_source": { "const": true },
            "max_items_per_doc": { "type": "integer" }
          }
        },
        "specialty_rules": {
          "type": "object",
          "properties": {
            "prefer_filename_tokens": { "type": "array", "items": { "type": "string" } },
            "prefer_title_keywords": { "type": "object", "additionalProperties": { "type": "string" } },
            "if_ambiguous": { "const": "UNKNOWN" }
          }
        }
      }
    },
    "chunking": {
      "type": "object",
      "required": ["strategy", "target_chars", "max_chars", "min_chars", "overlap_chars"],
      "properties": {
        "strategy": { "enum": ["section_aware_sliding"] },
        "target_chars": { "type": "integer" },
        "max_chars": { "type": "integer" },
        "min_chars": { "type": "integer" },
        "overlap_chars": { "type": "integer" },
        "never_split_regex": { "type": "array", "items": { "type": "string" } },
        "preserve_lists": { "type": "boolean" },
        "metadata_required_fields": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "sqlite": {
      "type": "object",
      "properties": {
        "db_path": { "type": "string" },
        "tables": {
          "type": "object",
          "properties": {
            "documents": { "type": "string" },
            "sections": { "type": "string" },
            "chunks": { "type": "string" },
            "chunk_items": { "type": "string" }
          }
        },
        "upsert_key": { "type": "array", "items": { "type": "string" } }
      }
    },
    "success_criteria": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "check", "threshold"],
        "properties": {
          "id": { "type": "string" },
          "check": { "type": "string" },
          "threshold": {}
        }
      }
    },
    "forbidden_behaviors": { "type": "array", "items": { "type": "string" } },
    "output_paths": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "cheap_model_prompt_contract": {
      "type": "object",
      "description": "Exact I/O contract pasted into the cheap-model system prompt",
      "properties": {
        "input_artifact": { "type": "string" },
        "output_schema_ref": { "type": "string" },
        "response_format": { "const": "json_only" },
        "on_uncertainty": { "const": "use_null_or_UNKNOWN_and_set_flag" }
      }
    }
  }
}
```

### 2.3 Filled example — one PDF

```json
{
  "work_order_id": "WO-2026-0042",
  "doc_id": "DOC-042",
  "pdf_path": "inbox/fr_med/042_cardiologie_item_233_insuffisance_cardiaque.pdf",
  "language": "fr",
  "risk_tier": "MED",
  "source_profile": {
    "approx_pages": 48,
    "layout": "single_column",
    "has_toc": true,
    "encoding_notes": "UTF-8 after extract; watch for fi ligatures and 'œ'"
  },
  "pipeline": ["INGEST", "STRUCTURE", "CHUNK", "WRITE_SQLITE", "MECHANICAL_GATES"],
  "taxonomy": {
    "specialty_allowlist": [
      "Cardiologie",
      "Pneumologie",
      "Néphrologie",
      "Hépato-gastro-entérologie",
      "Neurologie",
      "Endocrinologie-Diabétologie",
      "Hématologie",
      "Infectiologie",
      "Rhumatologie",
      "Dermatologie",
      "Pédiatrie",
      "Gynécologie-Obstétrique",
      "Psychiatrie",
      "Médecine interne",
      "Urgences-Réanimation",
      "Anesthésie-Réanimation",
      "Chirurgie",
      "ORL",
      "Ophtalmologie",
      "Anatomie-Physiologie",
      "Pharmacologie",
      "Santé publique",
      "UNKNOWN"
    ],
    "default_specialty": "Cardiologie",
    "item_number_regex": "(?i)\\b(?:item|items)\\s*n?[°o.]?\\s*(\\d{1,3})\\b|\\bI(?:tem)?\\s*(\\d{1,3})\\b",
    "item_number_examples_valid": ["Item 233", "item n°233", "Items 233-234", "ITEM 233"],
    "item_number_examples_invalid": ["page 233", "figure 2.33", "ICD-10 I50", "233 mg"]
  },
  "extraction_rules": {
    "header_footer_strip": {
      "strip_lines_matching": [
        "(?i)^collège\\b",
        "(?i)^université\\b",
        "(?i)^page\\s*\\d+\\s*/\\s*\\d+$",
        "(?i)^confidential"
      ],
      "max_header_lines": 3,
      "max_footer_lines": 2
    },
    "heading_patterns": [
      {
        "level": 1,
        "regex": "(?m)^(?:PARTIE|CHAPITRE)\\s+[IVXLC\\d]+[\\.\\-:]?\\s+.+$",
        "example": "CHAPITRE 12. Insuffisance cardiaque"
      },
      {
        "level": 2,
        "regex": "(?m)^\\d+(?:\\.\\d+)*\\s+[A-ZÉÈÊÀÂÙÛÔÎÇ].{3,120}$",
        "example": "1. Définition et physiopathologie"
      },
      {
        "level": 3,
        "regex": "(?m)^\\d+\\.\\d+(?:\\.\\d+)?\\s+.+$",
        "example": "1.2 Classification NYHA"
      },
      {
        "level": 2,
        "regex": "(?m)^(?:I{1,3}|IV|V|VI{0,3}|IX|X)\\.\\s+.+$",
        "example": "II. Diagnostic"
      }
    ],
    "hierarchy_rules": {
      "max_depth": 4,
      "no_skip_levels": true,
      "section_id_format": "{doc_id}-S{sequential:04d}",
      "path_join": " > "
    },
    "item_binding_rules": {
      "scan_pages": "all",
      "first_n_pages": 5,
      "bind_scope": "section",
      "require_match_in_source": true,
      "max_items_per_doc": 12
    },
    "specialty_rules": {
      "prefer_filename_tokens": ["cardiologie", "cardio"],
      "prefer_title_keywords": {
        "insuffisance cardiaque": "Cardiologie",
        "nyha": "Cardiologie",
        "févg": "Cardiologie"
      },
      "if_ambiguous": "UNKNOWN"
    }
  },
  "chunking": {
    "strategy": "section_aware_sliding",
    "target_chars": 1800,
    "max_chars": 2400,
    "min_chars": 400,
    "overlap_chars": 200,
    "never_split_regex": [
      "(?s)\\|.*\\|.*\\|",
      "(?m)^(?:Tableau|Table)\\s+\\d+"
    ],
    "preserve_lists": true,
    "metadata_required_fields": [
      "doc_id",
      "chunk_index",
      "section_path",
      "item_numbers",
      "specialty",
      "page_start",
      "page_end",
      "char_start",
      "char_end",
      "text",
      "text_sha256"
    ]
  },
  "sqlite": {
    "db_path": "out/corpus.sqlite",
    "tables": {
      "documents": "INSERT OR REPLACE INTO documents(doc_id, pdf_path, specialty_primary, language, page_count, status)",
      "sections": "INSERT OR REPLACE INTO sections(section_id, doc_id, parent_id, level, title, path, page_start, page_end)",
      "chunks": "INSERT OR REPLACE INTO chunks(chunk_id, doc_id, chunk_index, section_id, specialty, page_start, page_end, text, text_sha256, char_count)",
      "chunk_items": "INSERT OR REPLACE INTO chunk_items(chunk_id, item_number)"
    },
    "upsert_key": ["doc_id", "chunk_index"]
  },
  "success_criteria": [
    {
      "id": "SC-01",
      "check": "pages.jsonl line count == source_profile.approx_pages ± 2 OR equals actual PDF page count",
      "threshold": { "page_delta_max": 2 }
    },
    {
      "id": "SC-02",
      "check": "every item_number in items.json matches taxonomy.item_number_regex AND appears as substring in some page text",
      "threshold": { "orphan_items_allowed": 0 }
    },
    {
      "id": "SC-03",
      "check": "specialty in specialty_allowlist",
      "threshold": { "invalid_specialty_count": 0 }
    },
    {
      "id": "SC-04",
      "check": "section tree: level increases by at most 1; path depth <= 4; no empty titles",
      "threshold": { "hierarchy_violations": 0 }
    },
    {
      "id": "SC-05",
      "check": "all chunks: min_chars <= char_count <= max_chars except last chunk of section (>= 200)",
      "threshold": { "size_violations_max": 0 }
    },
    {
      "id": "SC-06",
      "check": "sum of unique chunk text coverage of body pages >= 0.92 of non-header body chars",
      "threshold": { "coverage_min": 0.92 }
    },
    {
      "id": "SC-07",
      "check": "write_receipt.chunk_rows == len(chunks.jsonl)",
      "threshold": { "row_mismatch": 0 }
    }
  ],
  "forbidden_behaviors": [
    "Do not invent Item numbers not present in source text.",
    "Do not translate French text to English.",
    "Do not output free-form prose; JSON only for STRUCTURE and CHUNK stages.",
    "Do not use specialties outside specialty_allowlist.",
    "Do not skip MECHANICAL_GATES.",
    "Do not call external tools except those listed in the orchestrator allow-list for this work order."
  ],
  "output_paths": {
    "pages": "raw/DOC-042/pages.jsonl",
    "sections": "struct/DOC-042/sections.json",
    "items": "struct/DOC-042/items.json",
    "specialties": "struct/DOC-042/specialties.json",
    "chunks": "chunks/DOC-042/chunks.jsonl",
    "write_receipt": "load/DOC-042/write_receipt.json",
    "gate_log": "gates/DOC-042/gate_log.json"
  },
  "cheap_model_prompt_contract": {
    "input_artifact": "For STRUCTURE: raw/DOC-042/pages.jsonl + this work order. For CHUNK: sections.json + pages.jsonl + this work order.",
    "output_schema_ref": "schemas/sections.schema.json | schemas/chunks.schema.json",
    "response_format": "json_only",
    "on_uncertainty": "use_null_or_UNKNOWN_and_set_flag"
  },
  "hints_from_planner": {
    "expected_primary_item": "233",
    "expected_title_substring": "Insuffisance cardiaque",
    "filename_derived_specialty": "Cardiologie",
    "known_toc_pages": [1, 2],
    "note": "If multiple items appear (e.g. 233 and 234), keep all that match regex and appear in text; do not drop secondary items."
  }
}
```

**Why this is weak-model-safe:** every decision is reduced to (a) regex match, (b) allow-list membership, (c) numeric range, or (d) copy-from-source. The cheap model is not asked to “understand medicine,” only to **tag and slice**.

---

## 3. Where the 80% Goes Wrong — Failure Modes + Cheap Mechanical Checks

These checks run **in the orchestrator (Python/SQL/regex)**, zero frontier tokens, **before** any verifier call.

### Failure mode 1 — Hallucinated or corrupted item numbers

**How it fails:** Cheap model invents `Item 999`, normalizes badly (`233` → `223`), or tags ICD/page numbers as items.

| Mechanical check | Implementation |
|------------------|----------------|
| **Regex gate** | Every `item_number` must match `taxonomy.item_number_regex` (or a normalized form `\d{1,3}` in range 1–500 if using EDN bounds). |
| **Source attestation** | For each item, `re.search` on concatenated page text (or page windows cited by the model) must find a matching surface form (`Item 233`, `item n°233`, etc.). Orphans → fail. |
| **Cardinality bound** | `0 ≤ len(items) ≤ max_items_per_doc` (e.g. 12). |
| **Filename/title consistency (soft→hard)** | If work order `hints_from_planner.expected_primary_item` set, that item **must** appear in extracted set (hard fail if missing). |
| **Set equality across stages** | Union of `chunk.item_numbers` ⊆ `items.json`; no chunk-only items. |

**On fail:** Cheap retry STRUCTURE with error: `ORPHAN_ITEMS=[...]`; after 2 fails → escalate HIGH.

---

### Failure mode 2 — Section hierarchy drift

**How it fails:** Skips levels (H1→H3), duplicates paths, invents headings not in text, TOC lines mixed as body sections, depth explosion.

| Mechanical check | Implementation |
|------------------|----------------|
| **Level monotonicity** | Walking document order, level may increase by **at most +1**; decrease unrestricted to ≥1. Count violations. |
| **Depth cap** | `level ≤ max_depth` (4). |
| **Title attestation** | Normalized heading title must appear as a line/substring in the claimed `page_start..page_end` text (fuzzy: whitespace-collapsed equality ≥ 0.9 SequenceMatcher **or** exact line match). |
| **Path consistency** | `path` must equal `join(ancestors.titles)` with `path_join`; parent_id must form a tree (single root or ordered forest), no cycles (union-find / DFS). |
| **Section count sanity** | `1 ≤ n_sections ≤ pages * k` (e.g. k=3); zero sections with `page_count ≥ 3` → fail. |
| **TOC isolation** | If `has_toc` and pages in `known_toc_pages`, headings only from those pages must be marked `is_toc=true` and **not** chunked as body (chunker skip list). |

**On fail:** Retry STRUCTURE; preserve page text, re-emit tree only.

---

### Failure mode 3 — Chunk boundary / coverage failure

**How it fails:** Chunks too long/short; missing pages; duplicated blocks; overlap wrong; tables split into nonsense; metadata pages only.

| Mechanical check | Implementation |
|------------------|----------------|
| **Size histogram** | Each chunk: `min_chars ≤ len(text) ≤ max_chars`, except last chunk of a section may be ≥ 200. |
| **Coverage** | Map chunks to page char spans; body coverage ≥ 0.92 of non-boilerplate chars; uncovered page spans longer than 500 chars → fail. |
| **Hash / near-dupe** | `text_sha256` unique per doc; optional normalized Jaccard > 0.95 between non-overlapping-index chunks → fail. |
| **Index continuity** | `chunk_index` is `0..n-1` contiguous. |
| **Page range validity** | `1 ≤ page_start ≤ page_end ≤ page_count`. |
| **Section attachment** | Every chunk `section_id` exists in `sections.json`. |
| **Overlap bound** | Adjacent chunks within same section: character overlap ≤ `overlap_chars * 1.5` and ≥ 0 if policy requires. |

**On fail:** Retry CHUNK only (do not re-extract structure if structure gates passed).

---

### Failure mode 4 — Specialty / metadata schema corruption

**How it fails:** Free-text specialty (`cardio`, `Heart`), wrong language tags, missing required JSON fields, SQLite type errors, silent partial writes.

| Mechanical check | Implementation |
|------------------|----------------|
| **JSON Schema validation** | Draft-2020-12 validate `sections.json`, `items.json`, `chunks.jsonl` line-by-line. |
| **Allow-list enum** | `specialty ∈ specialty_allowlist` exactly (case-sensitive as planned). |
| **Required keys** | Every chunk has `metadata_required_fields`; missing → fail. |
| **SQL constraints** | FK checks ON; NOT NULL columns; transaction rowcount == receipt; `PRAGMA foreign_key_check`. |
| **Language heuristic** | French function-word ratio on sample of chunk text (`le|la|les|des|une|est|dans|pour|avec`) ≥ threshold; if below, flag (hard fail only if English-dominant). |
| **Idempotency** | Re-run WRITE yields same `count(*)` for `doc_id` and same aggregate `sum(length(text))`. |

**On fail:** Repair JSON with deterministic normalizer where possible (map `cardio`→`Cardiologie` **only** via explicit alias table from planner); else cheap retry; else escalate.

---

### Gate pipeline order (per PDF)

```
INGEST → GateA (page count, non-empty)
  → STRUCTURE → GateB (items + hierarchy + specialty)
    → CHUNK → GateC (size + coverage + schema)
      → WRITE → GateD (SQL + receipt)
        → status=MECH_PASS | MECH_FAIL_ESCALATE
```

**Only `MECH_PASS` docs enter the verifier’s routine sample pool.** Escalations always go to verifier (budgeted).

---

## 4. Verifier Sampling Strategy (Risk-Weighted + Escalation)

Frontier cannot read all 120 PDFs within 10% tokens. Use **risk-weighted sampling + forced escalation + light statistical audit**.

### 4.1 Risk score (computed pre- and post-cheap)

Initial risk from planner + updated after gates:

| Signal | Points |
|--------|--------|
| Layout `two_column` / `slides` / `mixed` | +2 |
| `has_toc` false but pages > 20 | +1 |
| Cheap retries used (≥1) | +2 |
| Cheap retries exhausted (escalation) | +5 (auto review) |
| Item count = 0 on clinical course PDF | +2 |
| Item count ≥ 5 | +1 |
| Coverage gate between 0.92–0.95 (barely pass) | +1 |
| Specialty `UNKNOWN` | +2 |
| Filename/item hint mismatch resolved by alias | +1 |
| Page count ≥ 80 | +2 |
| OCR-ish high non-word rate | +3 |

**Tiers:** LOW 0–2, MED 3–5, HIGH ≥6, **ESCALATED** = gate failure after retries.

### 4.2 Actual sample sizes (out of 120)

Assume after cheap pass: **~108 MECH_PASS**, **~12 ESCALATED** (10% fail-to-escalate rate is a planning assumption; adjust live).

| Bucket | Population (approx.) | Verifier review rate | PDFs reviewed | What is reviewed per PDF |
|--------|----------------------|----------------------|---------------|---------------------------|
| **ESCALATED** | 12 | **100%** | **12** | Full structure + all items + 8–12 chunks + disputed pages |
| **HIGH** | ~18 | **50%** | **9** | All items + full section tree skim + 6 random chunks + 2 edge chunks (first/last) |
| **MED** | ~40 | **20%** | **8** | Items list + 4 chunks stratified by section |
| **LOW** | ~50 | **8%** | **4** | 2 random chunks + item list only |
| **Global audit** | all MECH_PASS | SQL-only (no LLM) | 0 frontier | Aggregate queries (below) |
| **Total PDF-level frontier reviews** | | | **~33 PDFs** | ≈ **27.5%** of corpus by doc count, concentrated on risk |

**Chunk-level focus:** For sampled PDFs, do **not** read every chunk. Cap frontier reading at ~**10 chunks equivalent** of text per HIGH/ESCALATED doc, ~4 MED, ~2 LOW.

**Expected reviewed PDFs:** 12 + 9 + 8 + 4 = **33**.  
**Unreviewed MECH_PASS:** 108 − (9+8+4) = **87** (rely on mechanical gates + global audit).

### 4.3 Stratified selection rules

1. Always include ≥1 PDF per specialty present in corpus (force-add if random sample misses).
2. Always include the **longest** PDF and the **shortest** multi-page PDF in HIGH or forced sample.
3. Random seed fixed (`corpus_plan.seed`) for reproducibility.
4. If a LOW/MED sample **fails** semantic review, **escalate that specialty cluster**: review +2 additional PDFs from same specialty (contagion rule), paid from verifier reserve.

### 4.4 Escalation policy (with numbers)

| Trigger | Action | Budget impact |
|---------|--------|----------------|
| Mechanical fail after 2 cheap retries | Full verifier review of that PDF; emit `repair_order` or `reject` | ~12 PDFs baseline |
| Verifier finds **critical** error (wrong primary item, fabricated section) | Repair order → cheap re-CHUNK/STRUCTURE → re-gate → **re-verify that PDF only** | +1 review |
| Verifier finds **systemic** error (same bug ≥3 sampled PDFs) | Stop-the-line: planner micro-update of work-order templates (from **planner reserve**, not verifier); re-run cheap on affected set | rare |
| Contagion from failed sample | +2 PDFs same specialty | ≤ +10 PDFs hard cap |
| **Hard cap** | Frontier review ≤ **40 PDFs** or **10% token budget**, whichever first | Orchestrator enforces |

### 4.5 Global non-LLM audit (always, free of frontier)

Run on full SQLite:

- Distribution of items, specialties, chunk lengths.
- Duplicate `text_sha256` across docs.
- Docs with zero items; docs with `UNKNOWN` specialty.
- Orphan FKs (should be zero).
- Chunks/pages ratio outliers (z-score > 3).

Outliers can promote a PDF from LOW→HIGH sampling **before** verifier runs.

### 4.6 Verifier verdict schema (per reviewed PDF)

```json
{
  "doc_id": "DOC-042",
  "verdict": "pass|repair|reject",
  "severity": {
    "items_grounded": true,
    "hierarchy_faithful": true,
    "specialty_ok": true,
    "chunk_coherence": true
  },
  "defects": [],
  "repair_order_path": null,
  "confidence": 0.0
}
```

Repair orders are **narrow** (e.g. “re-bind items on pages 1–3 only; do not rechunk pages 10–48”) so cheap rework stays small.

---

## 5. Token Math — Proving 10-80-10

### 5.1 Assumptions (explicit)

| Parameter | Value | Notes |
|-----------|--------|------|
| PDFs | 120 | |
| Avg pages / PDF | 40 | medical course notes |
| Avg extracted chars / page | 2 000 | ~500 tokens/page raw (4 chars≈1 token rough for FR) |
| Raw text tokens / PDF | ~20 000 | 40×500; **not all fed to LLM** |
| Cheap model context strategy | Map-reduce by page batches of 8–10 pages | structure stage |
| Frontier planner | Global plan + 120 compact work orders | |
| Frontier verifier | ~33 PDFs sampled/escalated as above | |
| Token definition | ≈ cl100k-ish; French ~10–20% denser than English — we use round numbers | |
| **Total LLM tokens (all models)** | Sum of prompt+completion billed units across stages | Embeddings/OCR non-LLM excluded from 10-80-10 |

Non-LLM extract of full PDF text does **not** count toward the 10-80-10 split; only **model tokens** do.

### 5.2 Per-PDF cheap path (typical MECH_PASS, no retry)

| Stage | Model | Prompt tokens (approx.) | Completion tokens | Total / PDF |
|-------|--------|-------------------------|-------------------|-------------|
| E0 Ingest repair notes (optional) | Cheap | 1 000 | 300 | **1 300** |
| E1 Structure (4 batches × ~8–10 pages) | Cheap | 4 × 6 000 = 24 000 | 4 × 1 200 = 4 800 | **28 800** |
| E1 Merge structure (reduce) | Cheap | 3 000 | 1 500 | **4 500** |
| E2 Chunk (section batches, ~6 calls) | Cheap | 6 × 4 500 = 27 000 | 6 × 1 000 = 6 000 | **33 000** |
| E3 Write | Non-LLM | 0 | 0 | **0** |
| **Subtotal cheap happy path** | | | | **≈ 67 600** |

**With retries:** assume 25% of PDFs retry one stage once ≈ +0.25 × 30 000 ≈ **+7 500** average → **~75 000 cheap tokens / PDF** blended.

**120 PDFs cheap total:** 120 × 75 000 = **9 000 000** tokens.

### 5.3 Planner (frontier) — once

| Item | Tokens |
|------|--------|
| System + schema design + taxonomy drafting | 25 000 |
| Skim of 8 sample PDFs × ~8 000 tokens (selected pages only) | 64 000 |
| Emit 120 work orders × ~1 800 tokens each (completion-heavy) | 216 000 |
| Risk tiers + gate YAML + SQLite DDL | 15 000 |
| **Planner total** | **≈ 320 000** |

### 5.4 Verifier (frontier) — end

| Bucket | PDFs | Tokens / PDF (prompt+completion) | Subtotal |
|--------|------|----------------------------------|----------|
| Escalated | 12 | 18 000 | 216 000 |
| HIGH sample | 9 | 12 000 | 108 000 |
| MED sample | 8 | 7 000 | 56 000 |
| LOW sample | 4 | 4 000 | 16 000 |
| Contagion reserve / re-verify | ~5 | 10 000 | 50 000 |
| Corpus-level acceptance synthesis | 1 | 20 000 | 20 000 |
| **Verifier total** | | | **≈ 466 000** |

### 5.5 Budget table (totals)

| Stage | Model tier | Tokens | % of grand total |
|-------|------------|--------|------------------|
| **Planner (start)** | Frontier | 320 000 | **3.3%** |
| **Executors (middle)** | Cheap | 9 000 000 | **92.0%** |
| **Verifier (end)** | Frontier | 466 000 | **4.8%** |
| **Frontier combined** | | 786 000 | **8.0%** |
| **Grand total LLM** | | **9 786 000** | 100% |

### 5.6 Enforcing the stated 10-80-10 *shape*

The raw operational optimum above is closer to **~4% / 92% / 5%** (frontier under-spending). The constraint is **caps** (≤10% start, ≤10% end, ≥80% middle), not exact equality. To **spend up to** the allowed 10+10 without violating the spirit (optional padding for harder corpora):

| Allocation | Token budget | % |
|------------|--------------|---|
| Planner ceiling | 0.10 × T | 10% |
| Cheap floor | 0.80 × T | 80% |
| Verifier ceiling | 0.10 × T | 10% |

**If we set target grand total T from cheap work** (cheap is the driver):

- Cheap actual C = 9.0M → for C ≥ 0.80 T ⇒ T ≤ C/0.80 = **11.25M**
- Frontier total F ≤ 0.20 T → if T = C + F and C = 9.0M, F ≤ 2.25M  
- Our F ≈ 0.79M ≪ 2.25M → **comfortably inside 10-80-10**

**Normalized “booked” 10-80-10 report** (for governance dashboards):

| Phase | Role | Tokens (booked) | Share | Notes |
|-------|------|-----------------|-------|-------|
| Start 10% | Planner (frontier) | 320k (actual) / up to ~1.1M cap | ≤10% | Cap = 10% of (C/0.8) ≈ 1.125M |
| Middle 80% | Executors (cheap) | 9.0M | ≥80% | Includes retries |
| End 10% | Verifier (frontier) | 466k (actual) / up to ~1.1M cap | ≤10% | Cap shared with planner under 20% frontier total; each phase still ≤10% if planner 320k + verifier ≤1.1M |

**Per-PDF average (illustrative):**

| | Frontier | Cheap |
|--|----------|-------|
| Tokens / PDF amortized | Planner 320k/120 ≈ 2.7k + verifier 466k/120 ≈ 3.9k → **~6.6k** | **~75k** |
| Share | **~8%** | **~92%** |

### 5.7 Sensitivity (still holds)

| Scenario | Cheap tokens | Frontier tokens | Frontier % |
|----------|--------------|-----------------|------------|
| Baseline | 9.0M | 0.79M | 8.0% |
| Hard corpus (+50% cheap structure/chunk) | 13.5M | 0.95M (more escalations) | 6.6% |
| More escalations (24) + contagion | 9.3M | 1.1M | 10.6% → **trim verifier sample on LOW/MED** to stay ≤10% end |
| Planner emits richer work orders (+100k) | 9.0M | 0.89M | 9.0% |

**Control knob if end-phase approaches 10%:** drop LOW sample from 8% to 4% (save ~2 PDFs) and shrink MED chunk reads before cutting HIGH/ESCALATED.

### 5.8 What is deliberately *not* counted in the 10-80-10 LLM budget

- PDF bytes, pymupdf extraction CPU  
- Embedding model tokens (if separate RAG index build)  
- JSON Schema / regex / SQLite gates  
These may be large operationally but are not frontier/cheap **chat** tokens; keeping them out prevents fake compliance.

---

## 6. End-to-End Flow (Summary Diagram)

```
                    ┌─────────────────────────────┐
                    │ PLANNER (frontier, ≤10%)    │
                    │ corpus_plan + 120 work orders│
                    │ taxonomy, gates, risk_tiers  │
                    └──────────────┬──────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   WorkOrder DOC-001        WorkOrder DOC-042         WorkOrder DOC-120
         │                         │                         │
         ▼                         ▼                         ▼
   ┌──────────────────────────────────────────────────────────┐
   │ EXECUTORS cheap (≥80%):  E0 Ingest → E1 Structure →      │
   │   E2 Chunk → E3 SQLite   + mechanical gates + ≤2 retries │
   └──────────────────────────┬───────────────────────────────┘
                              │
              MECH_PASS ──────┼────── MECH_FAIL → ESCALATE
                              ▼
                    ┌─────────────────────────────┐
                    │ VERIFIER (frontier, ≤10%)   │
                    │ risk sample ~33 PDFs        │
                    │ + 100% escalations          │
                    │ repair orders → cheap redo  │
                    │ corpus_acceptance.json      │
                    └─────────────────────────────┘
                              │
                              ▼
                    corpus.sqlite (RAG-ready)
```

---

## 7. SQLite Target Sketch (Planner-Owned Schema)

```sql
CREATE TABLE documents (
  doc_id TEXT PRIMARY KEY,
  pdf_path TEXT NOT NULL,
  specialty_primary TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language = 'fr'),
  page_count INTEGER NOT NULL,
  status TEXT NOT NULL, -- mech_pass|accepted|repair|rejected
  risk_tier TEXT
);

CREATE TABLE sections (
  section_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id),
  parent_id TEXT REFERENCES sections(section_id),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL
);

CREATE TABLE chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id),
  chunk_index INTEGER NOT NULL,
  section_id TEXT NOT NULL REFERENCES sections(section_id),
  specialty TEXT NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  UNIQUE(doc_id, chunk_index)
);

CREATE TABLE chunk_items (
  chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id),
  item_number TEXT NOT NULL,
  PRIMARY KEY (chunk_id, item_number)
);

CREATE INDEX idx_chunks_specialty ON chunks(specialty);
CREATE INDEX idx_chunk_items_item ON chunk_items(item_number);
```

---

## 8. Design Rationale (concise)

1. **Frontier only where ambiguity is global** (schema, taxonomy, work-order clarity, semantic audit) — not where volume lives (page text).  
2. **Cheap models execute closed contracts**; ambiguity is pushed into planner-written regexes and allow-lists.  
3. **Mechanical gates absorb the majority of cheap-model failure mass** so the 10% verifier budget is spent on residual semantic risk.  
4. **Risk-weighted sampling** reviews ~33/120 docs but nearly all high-risk mass; 100% escalation coverage prevents silent gate failures.  
5. **Token math** shows frontier ~8% total with clear caps and knobs to guarantee ≤10% / ≥80% / ≤10% under stress.

---

*End of Task 7.2 deliverable.*
