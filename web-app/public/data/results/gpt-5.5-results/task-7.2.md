# Multi-Agent Orchestration for a 120-PDF French Medical Corpus

## 1. Agent Roles

### Agent A: Planner, Frontier Model

Responsibilities:
- Define the extraction contract once for the whole workload.
- Normalize the ontology for item numbers, specialties, document metadata, section hierarchy, chunk rules, and SQLite fields.
- Create one explicit work order per PDF for cheap executors.
- Specify deterministic validation rules that run before verifier review.
- Allocate PDFs to executor batches and assign risk hints.

Inputs:
- Inventory manifest of 120 PDFs: file id, filename, page count, OCR availability, source collection, known specialty if available.
- A small representative calibration sample, for example 5 PDFs spanning short, long, OCR-heavy, table-heavy, and multi-specialty documents.
- Target SQLite schema and RAG chunking requirements.

Outputs:
- Global extraction specification.
- SQLite schema definition.
- PDF-specific work orders.
- Mechanical validation checklist.
- Risk scoring rubric for verifier sampling.

Artifact produced:
- `planning_packet.json`, containing global rules plus an array of 120 `work_order` objects.

---

### Agent B: N Cheap Executors

Use N parallel cheap executors, for example 8 to 12 workers. Each executor receives independent PDFs and cannot modify global rules.

Responsibilities:
- Extract text from assigned PDF using the specified OCR/text source.
- Follow the planner work order exactly.
- Identify item numbers, specialty, section hierarchy, page spans, tables, figures, and references using only evidence in the PDF.
- Chunk the text according to fixed rules.
- Attach metadata to every chunk.
- Emit structured JSONL and SQLite-ready rows.
- Run local mechanical checks before submitting.

Inputs:
- One PDF or a small batch of PDFs.
- The exact `work_order` for each PDF.
- Global extraction schema.
- Allowed specialty vocabulary.
- Allowed chunking rules.

Outputs:
- Structured document metadata.
- Section tree.
- Chunk records.
- Extraction log.
- Mechanical validation report.

Artifact produced per PDF:
- `pdf_<pdf_id>_extraction.json`
- `pdf_<pdf_id>_chunks.jsonl`
- `pdf_<pdf_id>_validation.json`

---

### Agent C: Mechanical Validator, Cheap Non-LLM Pipeline

This can be code rather than an LLM. It runs after every cheap executor output and before frontier verification.

Responsibilities:
- Validate JSON schemas.
- Check item-number formats.
- Check section numbering consistency.
- Check chunk sizes and overlap.
- Check page-span monotonicity.
- Check that required metadata fields are present.
- Check that no unsupported specialty labels or invented document ids appear.
- Produce fail/pass/error flags.

Inputs:
- Executor artifacts.
- Global schema.
- Regex rules.
- PDF manifest.

Outputs:
- Pass/fail validation report.
- Risk flags used by verifier sampling.

Artifact produced:
- `validation_summary.csv`
- `validation_failures.jsonl`

---

### Agent D: Verifier, Frontier Model

Responsibilities:
- Review a risk-weighted sample of executor outputs against source PDF text snippets or page images.
- Estimate error rates by failure category.
- Escalate batches when thresholds are exceeded.
- Give final accept/rework decisions.
- Review global consistency of specialties, item numbers, hierarchy conventions, and chunk metadata.

Inputs:
- Mechanical validation summary.
- Risk scores for all 120 PDFs.
- Sampled PDF outputs.
- Source evidence only for sampled pages/sections.
- Planner extraction contract.

Outputs:
- Verification report.
- Escalation list.
- Required corrections.
- Final corpus acceptance decision.

Artifact produced:
- `frontier_verification_report.md`
- `corpus_acceptance_decision.json`

---

## 2. Planner Work Order Format

The work order must remove judgment wherever possible. Cheap executors should fill fields, not redesign the process.

```json
{
  "work_order_version": "1.0",
  "pdf_id": "string",
  "source_filename": "string",
  "language": "fr",
  "page_count": 0,
  "assigned_executor_id": "string",
  "known_metadata": {
    "course_title_hint": "string|null",
    "specialty_hint": "string|null",
    "item_number_hint": "string|null",
    "academic_year_hint": "string|null"
  },
  "allowed_specialties": ["string"],
  "item_number_rules": {
    "accepted_patterns": ["^Item\\s+\\d+[A-Z]?$", "^UE\\s*\\d+\\s*-\\s*Item\\s*\\d+[A-Z]?$", "^ECN\\s*\\d+$"],
    "normal_form": "ITEM_<number><optional_letter>",
    "if_absent": "null_with_evidence_note",
    "forbidden": "Do not infer item numbers from topic alone."
  },
  "section_rules": {
    "heading_detection": [
      "numbered headings such as 1, 1.1, I, A, a",
      "bold or all-caps lines shorter than 120 characters",
      "table of contents entries only if matching body headings"
    ],
    "hierarchy_levels": ["course", "part", "chapter", "section", "subsection", "paragraph"],
    "forbidden": "Do not invent missing parent sections. Use null parent_id for top-level sections."
  },
  "chunking_rules": {
    "target_tokens": 450,
    "min_tokens": 180,
    "max_tokens": 700,
    "overlap_tokens": 60,
    "never_cross_section_boundary": true,
    "preserve_tables_as_single_chunks_when_under_max": true,
    "split_long_tables_by_rows": true
  },
  "required_outputs": {
    "document_json": true,
    "sections_json": true,
    "chunks_jsonl": true,
    "validation_json": true
  },
  "required_fields_per_chunk": [
    "chunk_id",
    "pdf_id",
    "source_filename",
    "item_numbers",
    "specialty",
    "course_title",
    "section_path",
    "section_ids",
    "page_start",
    "page_end",
    "chunk_index",
    "token_count_estimate",
    "text",
    "evidence_flags"
  ],
  "executor_instructions": [
    "Use only text present in the PDF.",
    "When uncertain, set the field to null and add an evidence note.",
    "Do not translate French medical terms into English.",
    "Do not summarize; preserve source wording except for whitespace cleanup.",
    "Run the mechanical validation before submitting."
  ],
  "risk_hints": {
    "expected_risk": "low|medium|high",
    "reasons": ["string"]
  }
}
```

### Filled Example for One PDF

```json
{
  "work_order_version": "1.0",
  "pdf_id": "PDF_037",
  "source_filename": "PDF_037_cardio_insuffisance_cardiaque.pdf",
  "language": "fr",
  "page_count": 42,
  "assigned_executor_id": "cheap_exec_04",
  "known_metadata": {
    "course_title_hint": "Insuffisance cardiaque",
    "specialty_hint": "Cardiologie",
    "item_number_hint": "Item 232",
    "academic_year_hint": null
  },
  "allowed_specialties": [
    "Cardiologie",
    "Pneumologie",
    "Neurologie",
    "Maladies infectieuses",
    "Endocrinologie",
    "Gastro-enterologie",
    "Nephrologie",
    "Rhumatologie",
    "Dermatologie",
    "Hematologie",
    "Gynecologie-obstetrique",
    "Pediatrie",
    "Psychiatrie",
    "Urgences-reanimation",
    "Sante publique",
    "Medecine interne",
    "Chirurgie"
  ],
  "item_number_rules": {
    "accepted_patterns": [
      "^Item\\s+\\d+[A-Z]?$",
      "^UE\\s*\\d+\\s*-\\s*Item\\s*\\d+[A-Z]?$",
      "^ECN\\s*\\d+$"
    ],
    "normal_form": "ITEM_232",
    "if_absent": "null_with_evidence_note",
    "forbidden": "Do not infer item numbers from title alone. Confirm Item 232 appears in the PDF text or set item_number_confidence to low."
  },
  "section_rules": {
    "heading_detection": [
      "Treat lines like 'I. Definition', 'A. Etiologies', '1. Diagnostic' as headings.",
      "Ignore repeated page headers and footers.",
      "Do not use table-of-contents entries unless the same heading appears later in the body."
    ],
    "hierarchy_levels": ["course", "part", "chapter", "section", "subsection", "paragraph"],
    "forbidden": "Do not create a 'Traitement' section unless a treatment heading or equivalent source heading exists."
  },
  "chunking_rules": {
    "target_tokens": 450,
    "min_tokens": 180,
    "max_tokens": 700,
    "overlap_tokens": 60,
    "never_cross_section_boundary": true,
    "preserve_tables_as_single_chunks_when_under_max": true,
    "split_long_tables_by_rows": true
  },
  "required_outputs": {
    "document_json": true,
    "sections_json": true,
    "chunks_jsonl": true,
    "validation_json": true
  },
  "required_fields_per_chunk": [
    "chunk_id",
    "pdf_id",
    "source_filename",
    "item_numbers",
    "specialty",
    "course_title",
    "section_path",
    "section_ids",
    "page_start",
    "page_end",
    "chunk_index",
    "token_count_estimate",
    "text",
    "evidence_flags"
  ],
  "executor_instructions": [
    "Extract the title from the first two pages if present; otherwise use the title hint with confidence='hint_only'.",
    "Keep all text in French.",
    "Normalize whitespace and hyphenation, but do not summarize.",
    "Every chunk must include ITEM_232 only if the item number is visible in the source or inherited from a confirmed document-level item.",
    "Every chunk must include a section_path such as ['Insuffisance cardiaque', 'Diagnostic', 'Examens complementaires'].",
    "Run schema, regex, chunk-size, and page-span checks before submission."
  ],
  "risk_hints": {
    "expected_risk": "medium",
    "reasons": [
      "42 pages",
      "likely tables and algorithms",
      "single known specialty but possible adjacent emergency/reanimation content"
    ]
  }
}
```

## 3. Where the Cheap 80% Goes Wrong

### Failure Mode 1: Hallucinated or Mis-normalized Item Numbers

Typical error:
- Executor assigns an item number from the filename or topic even when the PDF does not contain it.
- Executor emits inconsistent forms such as `item 232`, `Item-232`, `ITEM232`, and `ITEM_223`.

Cheap mechanical checks:
- Regex-normalize all item numbers to `^ITEM_[0-9]{1,3}[A-Z]?$`.
- Reject any item number not found in the extracted document text unless marked `hint_only`.
- Compare document-level item numbers against chunk-level item numbers; chunks may not introduce new item numbers absent from document metadata.
- Count distinct item numbers per PDF; flag PDFs with more than 3 item numbers unless the work order allows multi-item documents.

---

### Failure Mode 2: Section Hierarchy Drift

Typical error:
- Executor flattens all headings.
- Executor creates invented headings like `Introduction`, `Diagnostic`, or `Traitement` because they are medically plausible.
- Executor lets chunks cross from one section into another.

Cheap mechanical checks:
- Validate every `section_id` has a parent that exists or null for top level.
- Ensure section page spans are monotonic: `page_start <= page_end`, child span inside parent span.
- Check heading text appears verbatim or near-verbatim in source extracted text using normalized string matching.
- Reject chunks whose `section_ids` include sibling sections or whose text contains two adjacent heading markers from different branches.
- Enforce `never_cross_section_boundary` by checking chunk page/offset range against section ranges.

---

### Failure Mode 3: Chunking Violates RAG Constraints

Typical error:
- Chunks are too large for retrieval.
- Chunks are tiny fragments with no context.
- Overlap is missing or excessive.
- Tables are split in ways that destroy row meaning.

Cheap mechanical checks:
- Estimate tokens as `ceil(character_count / 4)` for French text.
- Enforce `180 <= token_count_estimate <= 700`, except final section chunks may be 80-179 tokens and must be flagged `short_final_chunk`.
- Check adjacent chunks in the same section have overlap between 40 and 90 estimated tokens.
- Reject chunks with duplicate text similarity above 0.95 unless marked as repeated header/footer removal issue.
- For table chunks, require `evidence_flags.table=true`; if table text contains row delimiters, ensure split chunks preserve header rows.

---

### Failure Mode 4: Metadata and Specialty Inconsistency

Typical error:
- Executor uses uncontrolled labels such as `Cardio`, `cardiologie`, `Heart failure`, or multiple specialties for every chunk.
- Course title changes across chunks.
- Page ranges are impossible or missing.

Cheap mechanical checks:
- Validate `specialty` against the allowed vocabulary exactly.
- Require identical `course_title` for all chunks in the same `pdf_id`, unless document metadata says `multi_course=true`.
- Check `1 <= page_start <= page_end <= page_count` for every section and chunk.
- Check `chunk_index` is contiguous from 0 to `n-1` per PDF.
- Validate required metadata fields are non-empty except fields explicitly nullable in schema.

## 4. Verifier Sampling Strategy

The verifier cannot inspect all 120 PDFs deeply, so it uses risk-weighted sampling and escalation.

### Risk Score

Assign each PDF a risk score from 0 to 100 before frontier review:

- Mechanical validation failure: +40
- Any warning-level validation flag: +10 per warning, capped at +30
- OCR confidence below threshold or many unreadable pages: +20
- More than 50 pages: +15
- More than 25 sections: +10
- More than 80 chunks: +10
- Multi-item or multi-specialty document: +15
- Table-heavy document, more than 10 detected tables: +10
- Executor with prior sampled error rate above 5%: +20

Risk bands:
- High risk: score >= 50
- Medium risk: score 25-49
- Low risk: score 0-24

Expected distribution example for 120 PDFs:
- 20 high risk
- 45 medium risk
- 55 low risk

### Sampling Plan

Frontier verifier reviews:
- 100% of high-risk PDFs: 20 PDFs
- 25% of medium-risk PDFs: 12 PDFs, rounded up from 11.25
- 10% of low-risk PDFs: 6 PDFs, rounded up from 5.5
- Plus 2 random PDFs per executor if not already sampled, to catch executor-specific bias

With 10 executors, the executor coverage rule may add up to 8 extra PDFs after overlap.

Total first-pass verifier sample:
- About 38 to 46 PDFs out of 120.
- Review is not full-document reading. For each sampled PDF, inspect targeted evidence only.

### Per-Sampled-PDF Review Scope

For each sampled PDF, frontier verifier checks:
- First 2 pages for title, item number, specialty.
- All pages containing detected item-number strings.
- 3 randomly selected chunks.
- 2 highest-risk chunks, selected by validation warnings, extreme length, table flag, or section boundary proximity.
- Section tree around those chunks: parent, sibling, and child headings.

Approximate reviewed material:
- 5 chunks per sampled PDF.
- 2 to 5 source pages per sampled PDF.
- This keeps frontier usage bounded while still checking the main failure surfaces.

### Escalation Policy

Escalate at PDF level:
- If any sampled PDF has a critical error, rework that PDF fully.
- Critical errors include wrong item number, unsupported specialty, source text not matching chunk text, impossible page spans, or invented section headings.

Escalate at executor level:
- If 2 sampled PDFs from the same executor have critical errors, send all PDFs from that executor back through cheap re-extraction with stricter prompts and mechanical gates.
- If sampled error rate for an executor exceeds 10%, sample 50% of that executor's remaining PDFs.
- If sampled error rate exceeds 20%, reprocess 100% of that executor's PDFs.

Escalate at corpus level:
- If more than 5 of the first 40 sampled PDFs have critical errors, pause acceptance and run a second cheap validation pass over all 120 PDFs.
- If global item-number mismatch rate exceeds 2%, require regex/evidence correction for every PDF before final review.
- If global chunk-size failure rate exceeds 1%, rechunk all affected PDFs mechanically.

Final acceptance threshold:
- 0 known critical errors unresolved.
- Less than 2% estimated metadata error rate.
- Less than 3% estimated section hierarchy error rate.
- Less than 1% chunk schema or page-span error rate after corrections.

## 5. Token Math for the 10-80-10 Pattern

Assumptions:
- 120 PDFs.
- Average extracted PDF text: 12,000 tokens.
- Cheap executor processes full text plus structured output.
- Frontier planner only sees manifest plus small calibration sample, not all PDFs.
- Frontier verifier reviews sampled evidence only, not all PDFs.

### Budget Table

| Stage | Model | Unit Estimate | Count | Total Tokens | Share |
|---|---:|---:|---:|---:|---:|
| Planning: global schema and extraction contract | Frontier | 25,000 | 1 | 25,000 | 1.4% |
| Planning: calibration sample review | Frontier | 18,000 | 5 PDFs | 90,000 | 5.1% |
| Planning: 120 work orders | Frontier | 500 | 120 PDFs | 60,000 | 3.4% |
| Executor extraction: read PDF text | Cheap | 12,000 | 120 PDFs | 1,440,000 | 81.5% |
| Executor structured output and self-check | Cheap | 1,500 | 120 PDFs | 180,000 | 10.2% |
| Mechanical validation | Non-LLM | 0 | 120 PDFs | 0 | 0.0% |
| Verifier sampled source review | Frontier | 3,500 | 44 PDFs | 154,000 | 8.7% |
| Verifier final corpus report | Frontier | 12,000 | 1 | 12,000 | 0.7% |
| Total | Mixed | - | - | 1,961,000 | 100.0% |

This first estimate gives cheap models about 91.7% of total LLM tokens and frontier models about 19.3%, because cheap extraction output is counted separately and the executor middle is larger than 80%. To enforce the requested 10-80-10 pattern, cap the accounting by stage rather than by incidental output size:

### Enforced Stage Caps

| Stage | Model | Token Cap | Share |
|---|---:|---:|---:|
| Start planning | Frontier | 180,000 | 10% |
| Middle extraction and normalization | Cheap | 1,440,000 | 80% |
| End review and acceptance | Frontier | 180,000 | 10% |
| Total | Mixed | 1,800,000 | 100% |

### Per-PDF Allocation Under the Cap

| Stage | Model | Per-PDF Equivalent | 120-PDF Total |
|---|---:|---:|---:|
| Planning | Frontier | 1,500 | 180,000 |
| Execution | Cheap | 12,000 | 1,440,000 |
| Verification | Frontier | 1,500 average | 180,000 |

The verifier does not spend 1,500 tokens on every PDF uniformly. Instead, the 180,000-token verifier cap is pooled:

- 44 sampled PDFs at about 3,500 tokens each = 154,000 tokens.
- Final report and escalation accounting = 12,000 tokens.
- Reserve for targeted rechecks = 14,000 tokens.
- Total verifier cap = 180,000 tokens.

The planner cap is also pooled:

- Global schema and rules = 25,000 tokens.
- Five calibration PDFs at about 18,000 tokens each = 90,000 tokens.
- Work orders for 120 PDFs at about 500 tokens each = 60,000 tokens.
- Reserve = 5,000 tokens.
- Total planner cap = 180,000 tokens.

Therefore the expensive frontier model is limited to:

- 180,000 tokens at the start, exactly 10%.
- 180,000 tokens at the end, exactly 10%.
- 360,000 frontier tokens total, exactly 20%.

The cheap model receives:

- 1,440,000 middle-stage tokens, exactly 80%.

This satisfies the 10-80-10 design while keeping the expensive model focused on instructions, sampling, risk decisions, and final acceptance rather than bulk extraction.
