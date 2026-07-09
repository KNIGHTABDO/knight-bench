# Multi-hop retrieval pipeline for a French medical (EDN) Q&A assistant — SQLite FTS5/BM25 only

Scope note: everything below is an original design proposal, not a report of an existing deployed system. I am not claiming any of these numbers (latency, hit rates) are measured facts — they are engineering targets/estimates for a system that does not exist yet, and I flag them as such throughout. No factual claims are made about real French medical exam content; the corpus example data (item numbers, chunk text) in section 4 is invented for illustration, as the task instructs.

## 1. Pipeline architecture

### Stages

```
Query in  →  [S0 Normalize+Classify]  →  [S1 Hop-1 Retrieve]  →  [S2 Bridge Extract]
          →  [S3 Hop-2 Retrieve (filtered)]  →  [S4 Merge+Rerank]  →  [S5 Stop?] → Answer/loop
```

**S0 — Normalize + classify the question.**
Lowercase (keep accents), strip stopwords for a *secondary* keyword-only view, run a lightweight French medical term matcher (regex/dictionary lookup, no ML) against a controlled vocabulary table (disease names, item numbers, specialty names). Classify the question shape with a small rule set: does it contain a "chain" pattern such as *"la complication la plus fréquente de X"*, *"le traitement de référence du diagnostic évoqué par Y"*, *"l'examen à réaliser devant Z"*? These patterns are the multi-hop trigger. If no chain pattern and a direct entity + attribute pair is found, go single-hop.

**S1 — Hop-1 retrieval.**
Query is built from the *outer* entity of the question (the disease/condition named literally in the text, e.g. "maladie X") plus a *slot label* describing what hop-1 must resolve (e.g. "complication", "diagnostic différentiel", "germe responsable", "examen de confirmation"). This is NOT the full question — it is the entity plus the slot keyword, run against a metadata-filtered FTS5 query (see §3) scoped preferentially to sections tagged `complications`, `diagnostic`, `étiologie`, etc., matching the slot.

**S2 — Bridge-entity extraction.**
From the top-k (k=3–5) hop-1 chunks, extract the candidate bridge entity — the actual name of the complication/diagnosis/pathogen. Two extraction techniques, both non-LLM by default:
- Structural: if the chunk's `section_header` is literally "Complications" and the chunk contains a bolded/first-listed noun phrase (chunks are pre-segmented at ingestion so the first sentence of a "complications" section is often "La complication la plus fréquente est ..." — a lexical pattern we can grep at ingestion time and pre-store in a `bridge_candidates` table, see §3).
- Fallback lexical: extract noun phrases via a small French UMLS/CIM-10-derived gazetteer (a static term list, e.g. "décompensation cardiaque", "hémorragie digestive"), matched by longest-substring against the chunk text, ranked by BM25 term-frequency proximity to superlative markers ("la plus fréquente", "principale", "majeure").
If S2 yields no confident candidate (no gazetteer hit, no structural marker), we optionally escalate to the LLM-reformulator variant (§2) purely for entity extraction — not for generating the query.

**S3 — Hop-2 retrieval.**
Query is built from: bridge entity (from S2) + the *original* question's requested attribute (e.g. "prise en charge", "traitement"), filtered by `item_number` inherited from hop-1's winning chunk (same EDN item, or same specialty as a relaxed fallback) and by section tags likely to hold the answer (`prise en charge`, `traitement`, `conduite à tenir`). This scoping is the main lever against BM25's lack of semantic understanding: we don't re-search the whole 40k-chunk corpus, we search a filtered subset (typically 200–800 chunks) with a query built from a resolved entity name rather than a vague pronoun/paraphrase.

**S4 — Merge + rerank.**
Concatenate hop-1's justification chunk (proof of which complication was selected) with hop-2's top chunks. Rerank the merged set with a cheap heuristic score (not a model): `final_score = bm25_score_hop2 * w1 + section_priority_boost * w2 + same_item_bonus * w3`. Weights are tunable constants, not learned — this is a deliberate concession to the "no embeddings/no external services" constraint.

**S5 — Stopping criteria / max hops.**
- **Max hops = 2** for this failure class. The architecture supports a generic hop loop, but the case in scope (resolve-then-retrieve) only ever needs 2. A 3rd hop is allowed only if hop-2's top BM25 score is below a floor threshold (see below) AND the question classifier detected a second chain marker (rare: "de sa complication la plus fréquente" chained twice). In practice, cap at 3 hops hard, to bound worst-case latency at 3×200ms.
- Stop after hop 1 (skip hop 2) if S0 classified the question as non-chained.
- Stop after hop 2 normally.
- Escalate/abort with a "low confidence" flag to the caller if: hop-1 top BM25 score < threshold T1 (empirically tune, e.g. rank score under FTS5's `bm25()` more negative than −2, since FTS5 returns negative scores where more negative = better match — so practically "score not sufficiently negative"/close to 0), or if S2 extraction returns zero candidates, or if hop-2 returns zero rows after filter relaxation. In all abort cases, fall back to a single-shot BM25 over the full corpus with the raw question, so the user always gets *something*, with a confidence flag "unresolved bridge entity" attached.

### Latency budget (target, not measured)
- S0 classify: ~1–3ms (regex/dictionary, in-process).
- S1 FTS5 query: budget ≤60ms (worst case cold cache on Workers; typically single-digit ms on a warm SQLite/D1 connection for a 40k-row FTS5 index).
- S2 extraction: ~1–5ms if structural/gazetteer only; if LLM fallback triggered, this dominates the budget (see §2, this is the expensive branch and should be rare, target <5% of queries).
- S3 filtered FTS5 query: ≤60ms (smaller candidate set than S1, so typically faster).
- S4 merge/rerank: ~1ms (in-memory over ≤20 rows).
- Total lexical-only path: comfortably under 200ms per hop, ~well under 200ms total for both hops combined in the non-LLM variant. The <200ms constraint stated in the task is "<200ms per hop" so each of S1 and S3 individually should target roughly half that (≤80–100ms) to leave headroom for S0/S2/S4 overhead and Worker cold-start jitter.

## 2. Query reformulation for hop 1

### 2A. Pure lexical/structural (no LLM in the loop)

Techniques, all deterministic and O(1) per query:

1. **Slot-pattern extraction via regex templates.** Maintain a small hand-written table of question templates → (entity-span regex, slot-keyword). E.g. pattern `prise en charge de la complication la plus fréquente de (?<entity>.+?)\s*\?` maps to slot = "complications", entity = capture group. This covers the dominant EDN phrasing patterns (there are a bounded number of canonical EDN question shapes: "quel diagnostic", "quelle est la complication...", "quel examen...", "quel traitement...", "quelle est la conduite à tenir devant...").
2. **Gazetteer entity normalization.** Once the entity span is captured ("maladie X" in the pattern, or the literal disease name in real questions), normalize it against a `entities` lookup table (aliases → canonical disease name → EDN item number) built at ingestion time from the collèges' own indices/glossaries. This turns "IDM", "infarctus du myocarde", "infarctus" all into one canonical token set for the FTS5 MATCH.
3. **Slot-to-section mapping.** A static dictionary maps slot keywords ("complication" → `["complications", "évolution", "pronostic"]` section tags; "traitement" → `["prise en charge", "traitement", "conduite à tenir"]`). This mapping is itself a lexical resource, not a model.
4. **FTS5 query construction.** Combine into an FTS5 MATCH expression using column-weighted boosts (`bm25(chunks_fts, 1.0, 3.0, 5.0, 1.0)` — weighting `section_header` and `chunk_text` differently, see §3) plus a `WHERE section IN (...)` pre-filter, unioned with an OR-fallback unfiltered search if the filtered one returns 0 rows (defends against inconsistent section tagging in source PDFs).

Cost/latency: effectively free — a few regex evaluations and a dictionary lookup, <2ms, fully deterministic, no network call, works identically in a Cloudflare Worker with zero cold-start risk beyond the Worker itself. Coverage is bounded by how many EDN question templates you enumerate; my estimate (not measured) is that a few dozen templates cover the large majority of "chained" EDN phrasing because EDN questions are famously formulaic, but long-tail or unusually worded questions will fail silently (regex won't match → treated as non-chained → wrong single-hop answer). This is the main weakness of 2A.

### 2B. Small LLM reformulator in the loop

Use a small, cheap model (e.g. a distilled/quantized French-capable model run on Workers AI or a small self-hosted model — the task forbids embeddings/external *retrieval* services but a lightweight LLM call for reformulation only is a different budget line, so this variant explicitly trades away part of the "no external services" purity for robustness) purely to:
- extract the entity span and the slot even when regex templates fail,
- optionally paraphrase the slot into 2–3 alternative French medical synonyms to broaden the FTS5 OR-query (e.g. "complication" → "complication", "évolution défavorable", "risque évolutif"),
- output the same structured (entity, slot) tuple that 2A produces by rule, so downstream S1/S3 code is unchanged — the LLM only replaces the extraction step, not the retrieval step.

Cost/latency (estimates, not benchmarked): a small model call adds roughly 50–300ms depending on model size/host and whether it's a cold or warm inference endpoint — this alone can consume the entire per-hop 200ms budget or blow past it, so in a Worker context this must run async/off the critical path where possible, or be reserved as a fallback only (triggered when 2A's regex/gazetteer path fails to match, or when S2 bridge extraction is inconclusive). Per-call cost is also nonzero (inference compute or API cost) versus 2A's effectively-zero cost. Recommendation: use 2A as the default hop-1 reformulator for latency and cost, and reserve 2B strictly as a fallback for the <10–20% of queries (estimate, unvalidated) that don't match any hand-written template — this keeps p50 latency low while improving recall on edge phrasing.

Comparison table:

| | 2A: lexical/structural | 2B: small LLM |
|---|---|---|
| Latency | ~1–2ms | ~50–300ms+ (estimate) |
| Cost/query | ~0 | nonzero compute/API cost |
| Coverage of phrasing variety | bounded by template count | broader, generalizes to unseen phrasing |
| Determinism/debuggability | fully deterministic, easy to unit test | non-deterministic, harder to regression-test |
| Failure mode | silent non-match → wrong hop routing | occasional hallucinated entity/slot |
| Fits "no external services" constraint as stated | yes | no, unless self-hosted on the same edge runtime |

## 3. SQLite schema

```sql
-- Core content table (source of truth; FTS5 table below is a shadow index over it)
CREATE TABLE chunks (
    chunk_id        INTEGER PRIMARY KEY,
    item_number     INTEGER NOT NULL,        -- EDN item number, e.g. 149
    specialty       TEXT NOT NULL,            -- e.g. 'Cardiologie'
    college         TEXT,                     -- source collège name
    section_header  TEXT NOT NULL,            -- e.g. 'Complications', 'Prise en charge'
    section_path    TEXT,                     -- breadcrumb, e.g. 'IV > Complications > Aiguës'
    chunk_text      TEXT NOT NULL,
    chunk_order     INTEGER,                  -- position within document, for neighbor expansion
    source_doc_id   TEXT,
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_chunks_item      ON chunks(item_number);
CREATE INDEX idx_chunks_specialty ON chunks(specialty);
CREATE INDEX idx_chunks_section   ON chunks(section_header);

-- FTS5 virtual table, external-content mode against chunks (keeps index small, avoids duplication)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    section_header,
    chunk_text,
    content='chunks',
    content_rowid='chunk_id',
    tokenize = "unicode61 remove_diacritics 2"   -- French accent-insensitive matching
);

-- Keep FTS5 in sync with chunks via triggers
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, section_header, chunk_text)
  VALUES (new.chunk_id, new.section_header, new.chunk_text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, section_header, chunk_text)
  VALUES ('delete', old.chunk_id, old.section_header, old.chunk_text);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, section_header, chunk_text)
  VALUES ('delete', old.chunk_id, old.section_header, old.chunk_text);
  INSERT INTO chunks_fts(rowid, section_header, chunk_text)
  VALUES (new.chunk_id, new.section_header, new.chunk_text);
END;

-- Controlled vocabulary / entity gazetteer, built at ingestion time
CREATE TABLE entities (
    entity_id       INTEGER PRIMARY KEY,
    canonical_name  TEXT NOT NULL,           -- e.g. 'infarctus du myocarde'
    entity_type     TEXT,                    -- 'disease' | 'complication' | 'pathogen' | 'drug' | 'exam'
    item_number     INTEGER,                 -- primary EDN item this entity belongs to
    specialty       TEXT
);

CREATE TABLE entity_aliases (
    alias_id    INTEGER PRIMARY KEY,
    entity_id   INTEGER NOT NULL REFERENCES entities(entity_id),
    alias_text  TEXT NOT NULL                -- 'IDM', 'infarctus', 'crise cardiaque' ...
);
CREATE INDEX idx_alias_text ON entity_aliases(alias_text);

-- Slot -> section-tag mapping (static reference table, used by S1/S3 query builder)
CREATE TABLE slot_section_map (
    slot            TEXT NOT NULL,           -- 'complication' | 'traitement' | 'diagnostic' | ...
    section_header  TEXT NOT NULL,           -- matching value(s) in chunks.section_header
    priority        INTEGER DEFAULT 1
);

-- Pre-computed bridge candidates, populated at ingestion by scanning "Complications"-type
-- sections for superlative lexical markers ("la plus fréquente", "principale", "majeure").
-- This lets S2 do a cheap lookup instead of re-parsing chunk text at query time.
CREATE TABLE bridge_candidates (
    chunk_id        INTEGER NOT NULL REFERENCES chunks(chunk_id),
    candidate_text  TEXT NOT NULL,           -- extracted noun phrase, e.g. 'insuffisance cardiaque'
    marker_type     TEXT,                    -- 'superlative_frequent' | 'superlative_severe' | 'listed_first'
    confidence      REAL DEFAULT 0.5
);
CREATE INDEX idx_bridge_chunk ON bridge_candidates(chunk_id);
```

Exploitation of metadata for filtered hops:
- **Hop-1** filters `WHERE chunks.item_number = ? ` when the entity resolves to a known EDN item (via `entities`/`entity_aliases`), narrowing 40k chunks to typically the ~10–40 chunks of that single item before BM25 even runs, which both speeds up the query and removes cross-item false positives (a different disease's "complications" section scoring well on generic terms).
- **Hop-2** inherits `item_number` (and `specialty` as a relaxed fallback if the strict item filter returns 0 rows) from the winning hop-1 chunk, and additionally filters `section_header` via `slot_section_map` for the "traitement"/"prise en charge" slot, so BM25 only competes among a pre-narrowed, topically-relevant candidate set — this is the core mechanism that compensates for BM25 having no semantic understanding of "the complication I just found in hop 1 is now the subject of hop 2."

## 4. Worked example

Question: *"Quelle est la prise en charge de la complication la plus fréquente de l'infarctus du myocarde ?"*

Invented chunk data (illustrative, not real collège content):

```sql
INSERT INTO entities VALUES (1, 'infarctus du myocarde', 'disease', 149, 'Cardiologie');
INSERT INTO entity_aliases VALUES (1,1,'infarctus du myocarde'), (2,1,'IDM'), (3,1,'infarctus');

INSERT INTO chunks VALUES
 (5001, 149, 'Cardiologie', 'Collège Cardio', 'Complications', 'IV.Complications.Aigues',
  'La complication la plus fréquente de l''infarctus du myocarde à la phase aiguë est l''insuffisance cardiaque aiguë, favorisée par l''étendue de la nécrose myocardique.',
  12, 'doc_cardio_149', datetime('now')),
 (5002, 149, 'Cardiologie', 'Collège Cardio', 'Prise en charge', 'V.PriseEnCharge.InsuffisanceCardiaque',
  'La prise en charge de l''insuffisance cardiaque aiguë post-infarctus repose sur les diurétiques de l''anse, la ventilation non invasive si besoin, les dérivés nitrés IV, et la surveillance en unité de soins intensifs cardiologiques.',
  18, 'doc_cardio_149', datetime('now')),
 (5003, 149, 'Cardiologie', 'Collège Cardio', 'Prise en charge', 'V.PriseEnCharge.Generale',
  'La prise en charge générale de l''infarctus du myocarde comprend la double antiagrégation plaquettaire et la reperfusion en urgence.',
  15, 'doc_cardio_149', datetime('now'));

INSERT INTO bridge_candidates VALUES
 (5001, 'insuffisance cardiaque aiguë', 'superlative_frequent', 0.9);
```

**Hop 1 — resolve the entity + slot.**
S0/2A regex match: entity = "infarctus du myocarde", slot = "complication". Resolve entity via alias table:

```sql
SELECT e.entity_id, e.canonical_name, e.item_number
FROM entity_aliases a JOIN entities e ON e.entity_id = a.entity_id
WHERE a.alias_text = 'infarctus du myocarde';
-- -> entity_id=1, item_number=149
```

Hop-1 FTS5 query, filtered to item 149 and to the "complication" slot's mapped sections:

```sql
SELECT c.chunk_id, c.section_header, c.chunk_text,
       bm25(chunks_fts, 1.0, 3.0) AS score
FROM chunks_fts
JOIN chunks c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH 'complication* OR "insuffisance cardiaque"*'
  AND c.item_number = 149
  AND c.section_header IN (
        SELECT section_header FROM slot_section_map WHERE slot = 'complication'
      )
ORDER BY score
LIMIT 5;
-- -> top row: chunk_id 5001, score most negative (best match)
```

**Hop-1 → bridge extraction (S2).** Prefer the pre-computed table:

```sql
SELECT candidate_text, confidence
FROM bridge_candidates
WHERE chunk_id = 5001
ORDER BY confidence DESC
LIMIT 1;
-- -> 'insuffisance cardiaque aiguë', confidence 0.9
```

Bridge entity resolved: **"insuffisance cardiaque aiguë"** (confidence 0.9, above threshold — no LLM fallback needed).

**Hop 2 — retrieve management of the bridge entity, filtered.**

```sql
SELECT c.chunk_id, c.section_header, c.chunk_text,
       bm25(chunks_fts, 1.0, 3.0) AS score
FROM chunks_fts
JOIN chunks c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH '"insuffisance cardiaque"* AND (traitement* OR "prise en charge"*)'
  AND c.item_number = 149
  AND c.section_header IN (
        SELECT section_header FROM slot_section_map WHERE slot = 'traitement'
      )
ORDER BY score
LIMIT 5;
-- -> top row: chunk_id 5002 (management of insuffisance cardiaque aiguë post-infarctus),
--    correctly outranking chunk 5003 (general IDM management, wrong sub-topic)
```

**S4 merge:** return chunk 5001 (justification: which complication, and why it's "the most frequent") + chunk 5002 (the actual management answer) to the answer-generation stage, with metadata making clear which chunk resolved the bridge and which answers the final question.

Without the section/item filter, hop 2's plain query `"insuffisance cardiaque" traitement` over the full 40k corpus risks surfacing generic heart-failure management chunks from an unrelated cardiology item (e.g. chronic heart failure guidelines from a different item number), which would be topically plausible but wrong for the post-MI context — this is exactly the failure the item-number inheritance guards against.

## 5. Failure modes of this design and mitigations

1. **Bridge misidentification when multiple complications compete lexically.** If a chunk lists several complications ("les complications sont l'insuffisance cardiaque, les troubles du rythme et la rupture septale") without a clear superlative marker for the *most frequent* one, the structural/gazetteer extractor (S2) may pick the first-listed or highest-BM25-scoring noun phrase rather than the actually-most-frequent one, especially if source chunking split the ranking sentence from the list itself.
   *Mitigation:* at ingestion time, require the `bridge_candidates` extraction rule to specifically anchor on superlative/ranking markers ("la plus fréquente", "en premier lieu", "principale cause") rather than plain list membership, and store a `confidence` score; when confidence is below a threshold, either present the top-2 candidates to hop 2 in parallel (fan-out, still cheap since hop-2 queries are narrow) and merge both results, or escalate to the 2B LLM extractor as a targeted fallback.

2. **Filter over-narrowing causes false negatives (0 rows) when metadata is inconsistent or the answer lives in a different item/section than expected.** French collège documents are not perfectly consistent in section naming across specialties/editions; a strict `item_number` + `section_header IN (...)` filter can return zero hop-2 rows even though the answer exists in the corpus (e.g. under a section literally titled "Traitement" rather than "Prise en charge", or cross-referenced from a different item).
   *Mitigation:* implement filter relaxation as an explicit fallback ladder in S3: (a) item_number + mapped sections → (b) item_number only (drop section filter) → (c) specialty only → (d) no filter, full-corpus BM25 with the bridge entity as the sole query term. Each rung only fires if the previous one returns 0 rows or a score below threshold, keeping the common case fast while preserving recall on messy metadata. Also, expand `slot_section_map` empirically from real section-header value distributions observed at ingestion rather than a fixed guess list.

3. **Chain-question detection (S0) misses novel phrasings, silently degrading to a wrong single-hop answer with no visible error.** Because 2A's regex templates are hand-enumerated, any EDN question phrased in a way not covered by the templates (e.g. embedded/nested chains, or "quel est le traitement de la cause la plus probable de ce tableau clinique X" where the chain is implicit rather than marked by an obvious keyword like "complication") will be classified as non-chained and answered with a single BM25 pass against the literal question text — producing a plausible-looking but wrong answer with no explicit failure signal to the user.
   *Mitigation:* two layers — first, treat "single-hop answer with unusually low top BM25 score" as a signal to retry through the chain path even without a template match (score-triggered escalation rather than purely pattern-triggered); second, budget the 2B small-LLM path as a periodic/async classifier improvement loop — log all "single-hop, low confidence" queries and use them to mine new regex templates offline, so template coverage grows from real failure data rather than upfront guessing. This keeps the runtime path lexical-only while still closing the coverage gap over time.
