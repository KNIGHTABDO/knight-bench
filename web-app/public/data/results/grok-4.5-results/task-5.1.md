# Multi-Hop Retrieval Pipeline for French Medical Q&A (EDN Prep)

**Constraints honored:** SQLite FTS5 + BM25 only · no embeddings · no external services · Cloudflare Worker or local process · <200 ms retrieval budget per hop · corpus ≈ 40k chunks from French medical collèges (item number, specialty, section headers, chunk text).

**Target failure class:** Single-shot BM25 fails on questions like *« Quelle est la prise en charge de la complication la plus fréquente de la maladie X ? »* because the answer is not co-located with disease X; hop 1 must resolve the complication entity, hop 2 must retrieve its management.

---

## 1. Pipeline Architecture

### 1.1 Overview (stages)

```
Q (user question)
    │
    ▼
┌─────────────────────────────────────┐
│ STAGE 0 — Preprocess & Intent Parse │  pure lexical/regex (no LLM required)
│  • Normalize FR medical text        │
│  • Detect multi-hop pattern         │
│  • Extract anchors (maladie X, etc.)│
│  • Classify hop type / need for hop │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ STAGE 1 — Hop-1 Retrieval           │  FTS5 BM25, budget ≤ 200 ms
│  Query built for BRIDGE entity      │
│  Optional metadata filters          │
│  Top-k chunks (k=5–10)              │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ STAGE 2 — Bridge Entity Extraction  │  lexical/structural (no embeddings)
│  • Section-aware phrase extraction  │
│  • Pattern tables for complications │
│  • Confidence score + entity list   │
└─────────────────┬───────────────────┘
                  │
         ┌────────┴────────┐
         │ stop?           │ continue
         ▼                 ▼
   Final answer      ┌─────────────────────────────────────┐
   context pack      │ STAGE 3 — Hop-2 Retrieval           │
                     │  Query = management/prise en charge │
                     │  + bridge entity (+ disease anchor) │
                     │  Stronger section filters           │
                     │  Top-k chunks (k=5–10)              │
                     └─────────────────┬───────────────────┘
                                       │
                                       ▼
                     ┌─────────────────────────────────────┐
                     │ STAGE 4 — Merge, Rerank, Pack       │
                     │  • Dedup by chunk_id                │
                     │  • Score fusion (BM25 + hop weight) │
                     │  • Section diversity / item pin     │
                     │  • Assemble context for answer gen  │
                     └─────────────────────────────────────┘
```

Optional hop 3 (rare): only if hop 2 still yields a relational answer (*« la complication de Y est Z »* without management text). Max hops = **3** hard cap; typical path is **2**.

### 1.2 What each hop’s query is built from

| Hop | Goal | Query sources | Typical FTS query shape |
|-----|------|---------------|-------------------------|
| **Hop 1** | Resolve the **bridge entity** (e.g. most frequent complication of maladie X) | (a) Disease/entity anchor extracted from Q; (b) **relational cue words** from Q (*complication*, *plus fréquente*, *étiologie*, *diagnostic différentiel*); (c) optional specialty/item filter if detectable from Q or prior session | `(maladie_X OR synonym) AND (complication OR complications) AND (fréquente OR fréquentes OR principale OR majeure)` + section boost via filter or secondary sort |
| **Hop 2** | Retrieve **answer content** about the bridge (prise en charge, traitement, conduite à tenir) | (a) Bridge entity phrase(s) from hop 1; (b) **task cue** from original Q (*prise en charge*, *traitement*, *CAT*); (c) optional disease anchor retained as soft term; (d) section filter favoring *Traitement / Prise en charge / CAT* | `(bridge_entity) AND (prise NEAR/3 charge OR traitement OR "conduite à tenir" OR CAT)` |
| **Hop 3** (optional) | Only if hop-2 top chunks are still definitional/complication lists | Bridge entity + expanded management synonyms + drop disease constraint if it was drowning results | Same as hop 2 with broader management lexicon, no disease filter |

### 1.3 Preprocess & multi-hop detection (Stage 0)

**Normalization (French medical):**
- Lowercase, NFC, strip diacritics *only for matching keys* (keep accented display forms).
- Expand common abbreviations via a static lexicon: `HTA → hypertension artérielle`, `IDM → infarctus du myocarde`, `BPCO`, `AVC`, `IRA`, `PEC → prise en charge`, `CAT → conduite à tenir`.
- Tokenize with FTS5 unicode61; keep hyphenated drug/disease forms (`beta-bloquants` → also `betabloquants` OR form).

**Multi-hop pattern detector (regex + dependency-lite templates):**

Patterns that **force multi-hop** (confidence ≥ threshold → run hop pipeline):

1. Nested relational:  
   `(prise en charge|traitement|CAT|conduite à tenir|diagnostic|pronostic).{0,40}(complication|effet indésirable|séquelle|cause|étiologie|facteur de risque|diagnostic différentiel).{0,40}(de|du|des|d')`
2. Superlative + relation:  
   `(plus fréquente?s?|principale?s?|majeure?s?|la plus commune).{0,30}(complication|cause|étiologie)`
3. Chain markers:  
   `(suite à|secondaire à|compliquant|compliquée? de)`

If pattern matches → `hop_plan = [RESOLVE_RELATION, ANSWER_TASK]`.  
If not → single-shot BM25 on full question (budget-friendly path).

**Anchor extraction (pure lexical):**
- Longest match against `entities` table (disease/item titles, collège headings).
- Fallback: capitalized multi-word spans / known suffixes (`-ite`, `-ose`, `-émie`) in medical French lists.
- Store: `anchor_disease`, `relation_type` (complication | cause | …), `task_type` (prise_en_charge | diagnostic | …).

### 1.4 Stopping criteria

Stop and pack context when **any** of the following holds:

1. **Max hops reached:** `hop ≥ 3` (hard stop).
2. **Bridge resolved with high confidence** after hop 1 AND hop 2 has already run: always stop after hop 2 if hop-2 returned ≥1 chunk with BM25 score above adaptive floor (`score ≥ median(top10 of hop2) * 0.4` or absolute `bm25_rank_score` threshold tuned offline).
3. **Early stop after hop 1 only** if original Q was *only* asking for the relation (*« Quelle est la complication la plus fréquente de X ? »* without management) — detect via absence of task cues.
4. **No bridge entity extracted** after hop 1 with confidence ≥ τ → fall back to single-shot on original Q + hop-1 chunks (degrade gracefully; do not invent hop-2 query).
5. **Hop-N empty / timeout:** if hop query exceeds 200 ms or returns 0 rows → stop with best available pack + flag `retrieval_degraded=true`.
6. **Entity saturation:** if hop 2 top-3 chunks already contain both bridge entity and task keywords in same chunk, no hop 3.

### 1.5 Max hops and budgets

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Max hops | **3** | Medical nested relations rarely need >2; 3 covers edge cases |
| Default hops for nested Q | **2** | Complication → management |
| Per-hop retrieval budget | **< 200 ms** | Hard SLA |
| Total retrieval budget | **≤ 500 ms** (2 hops + extract) | Leaves headroom for answer LLM |
| Top-k per hop | **8** (return) / **3–5** (used for extraction) | Balance recall vs Worker CPU |
| Bridge candidates kept | **1–3** | Multi-complication questions |

### 1.6 Per-hop execution (Cloudflare Worker–friendly)

1. Open SQLite (D1 / embedded wasm / local file) — connection warm if possible.
2. Apply **metadata pre-filter** (item_id / specialty) when confident → shrinks FTS scan.
3. Run `MATCH` with BM25 `ORDER BY bm25(chunks_fts) LIMIT k`.
4. Optional second pass: same terms, **section_type IN (...)** filter if first pass mixed.
5. Bridge extraction in pure JS/TS (regex + dictionary) — must stay well under residual budget (~20–40 ms).
6. Emit structured `HopResult{hop, query, chunk_ids, bridge_entities, latency_ms}`.

---

## 2. Query Reformulation Strategy

### 2.A WITHOUT LLM in the loop (hop 1) — pure lexical/structural

**Principle:** Rewrite the user question into a **relation-focused retrieval query** that maximizes chance of hitting the collège paragraph that *names* the complication, not the management section of the disease.

#### Techniques

**A. Template expansion by `relation_type`**

Static map (French EDN collège language):

| relation_type | Hop-1 query templates (AND-combined variants, best score wins) |
|---------------|----------------------------------------------------------------|
| complication | `{anchor} complication*`; `{anchor} "complication la plus fréquente"`; `{anchor} complications fréquentes`; `{anchor} "principale complication"` |
| cause / étiologie | `{anchor} étiologie*`; `{anchor} "causes les plus fréquentes"`; `{anchor} "étiologie principale"` |
| diagnostic différentiel | `{anchor} "diagnostic différentiel"`; `{anchor} différentiel*` |
| facteur de risque | `{anchor} "facteurs de risque"`; `{anchor} FDR` |

Run **2–3 template variants in one hop** either as:
- single FTS OR-query: `(q1) OR (q2) OR (q3)`, or  
- sequential micro-queries sharing the same 200 ms budget (stop when cumulative ≥ 1 high-score hit).

Prefer **one OR-combined MATCH** for Worker simplicity and single BM25 ranking pass.

**B. Cue demotion / term surgery**

From original Q, **drop task terms** that pull management chunks too early:
- Remove: `prise en charge`, `traitement`, `CAT`, `comment traiter`, `que faire`.
- Keep: disease anchor + relation superlative cues.

Example transform:

```
Q:  Quelle est la prise en charge de la complication la plus fréquente de la maladie de Crohn ?
→  hop1: ("maladie de Crohn" OR Crohn) AND (complication OR complications)
         AND (fréquente OR fréquentes OR principale OR "plus fréquente")
```

**C. Structural section bias (no embeddings)**

Prefer chunks whose `section_path` / `section_type` matches relation sections:

- Hop 1: `section_type IN ('complications','evolution','histoire_naturelle','pronostic')`  
  Fallback if empty: no section filter.
- Soft boost alternative if hard filter empty: run unfiltered FTS, then **re-sort** top-30 by  
  `score' = bm25_score + section_bonus` where  
  `section_bonus = -1.5` if section matches relation type (note: FTS5 bm25 is lower-is-better), else `0`.

**D. Item / specialty pin**

If Q or anchor maps to EDN **item number** (e.g. item 279 MICI):

```sql
... AND c.item_number = 279
```

Dramatically reduces false friends (*Crohn* mentioned in other items).

**E. Bridge extraction (post hop-1, still no LLM)**

From top-k hop-1 chunks, extract candidate phrases:

1. **Section header lines** containing `Complication` + bullet/paragraph that follows.
2. Regex patterns over French medical prose:
   - `complication (la plus )?fréquente (est|reste|:)\s+([A-ZÀ-Üa-zà-ü0-9 \-']{3,80})`
   - `principale complication\s*[:\-]\s*([^\.\n]{3,80})`
   - `complications?\s*:\s*([^\.\n]{3,120})` then take first NP-like segment
3. Prefer phrases that appear in **≥2** of top-k chunks or appear as **bold/header-like** (ALL CAPS, trailing `:`, markdown `**`).
4. Validate candidates against `entities` table (exact / prefix); if miss, keep raw surface form for hop 2.
5. Confidence:
   - `1.0` if pattern + entity table hit + correct item filter  
   - `0.7` if pattern only  
   - `0.4` if TF co-occurrence of relation words near candidate in chunk  
   - discard if `< 0.5` unless no better candidate

**F. Synonym / collège lexicon (static)**

Maintain a small offline table `term_synonyms(canonical, variant)` for French medical terms (no external API). Expand hop-1 anchors: `maladie de Crohn` ↔ `MICI` ↔ `iléite terminale` (careful: MICI is broader — use only if item-pinned).

#### Worked reformulation (no LLM)

```
Input Q:
  "Quelle est la prise en charge de la complication la plus fréquente de la maladie de Crohn ?"

Stage 0:
  anchor_disease = "maladie de Crohn"
  relation_type  = complication (superlative: plus_frequente)
  task_type      = prise_en_charge
  multi_hop      = true

Hop-1 FTS query string:
  ("maladie de Crohn" OR Crohn) AND (complication OR complications)
  AND (fréquente OR fréquentes OR "plus fréquente" OR principale OR majeures)

Optional filter:
  item_number = 279 OR specialty = 'hépato-gastro-entérologie'
  section_type IN ('complications','evolution')
```

### 2.B WITH a small LLM reformulator — variant comparison

Use a **small** reformulator only for hop planning / bridge naming (e.g. 1–3B local, or Worker AI small model). Still **no embeddings**; retrieval remains FTS5 BM25.

#### LLM hop-1 roles (minimal prompts)

1. **Query rewrite:** emit 1–3 FTS-friendly keyword strings (boolean-like, no prose).  
2. **Bridge extraction:** given hop-1 snippets (≤1.5k tokens), emit JSON:  
   `{ "bridge_entities": [{"name":"...", "confidence":0.0-1.0}], "item_guess": null }`  
3. **Hop-2 rewrite:** given Q + bridge, emit management-focused FTS query.

Prompt discipline for latency: max 256–512 output tokens; temperature 0; structured JSON only.

#### Cost / latency comparison (indicative, same corpus & Worker-class CPU)

| Metric | Pure lexical hop-1 | Small LLM reformulator |
|--------|--------------------|-------------------------|
| Hop-1 query build | **~1–5 ms** (regex + templates) | **+80–400 ms** (depends on model/host; often **exceeds** 200 ms hop budget alone if on-Worker) |
| Bridge extraction | **~5–30 ms** (regex + entity dict over top-8) | **+100–500 ms** on snippets |
| Retrieval FTS | same **10–80 ms** | same **10–80 ms** |
| Typical end-to-end 2-hop retrieval | **~40–150 ms** | **~250–1000+ ms** if LLM on critical path |
| Fits <200 ms **per hop**? | **Yes**, comfortably | **Risky**; only if LLM is offline/precomputed or hop budget redefined as “retrieval only” |
| Monetary cost (CF Worker AI / tokens) | **≈ 0** beyond SQLite | **Non-zero** per question; scales with Q volume |
| Robustness to paraphrase | Medium (lexicon-limited) | **Higher** on rare phrasings |
| Robustness to collège section jargon | High if templates tuned to collèges | High if few-shot with collège style |
| Failure on superlatives | Good with templates | Good; may hallucinate bridge name → **must verify against hop-1 text** |
| Recommended production default | **Lexical first** | LLM as **fallback** when bridge conf < τ or multi-hop detector uncertain |

#### Hybrid recommendation (best cost/latency)

1. Always run **lexical multi-hop** path first (meets SLA).  
2. If `bridge_confidence < 0.5` OR hop-2 BM25 max score weak → optional **async or second-pass LLM reformulation** (accept higher latency for hard questions only).  
3. Never trust LLM bridge entity without **substring / fuzzy containment** in hop-1 retrieved text (anti-hallucination gate).  
4. Cache reformulations keyed by normalized Q hash in SQLite (`query_cache`) for EDN-bank repeats.

---

## 3. Exact SQLite Schema (FTS5 + supporting tables)

### 3.1 Design notes

- **External-content FTS5** keeps full rows in `chunks` and searchable text in `chunks_fts` (easier updates, clear joins).
- Metadata used for **filtered hops** lives in relational columns + optional FTS auxiliary columns if you want `MATCH` on specialty (usually **SQL WHERE** is enough and faster to filter).
- BM25 via `bm25(chunks_fts)` (lower = better in SQLite).
- French tokenization: `tokenize = "unicode61 remove_diacritics 2"`; optional custom `tokenchars` for hyphens.

### 3.2 Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Reference: EDN items / collège structure
-- ---------------------------------------------------------------------------
CREATE TABLE items (
  item_number     INTEGER PRIMARY KEY,          -- e.g. 279
  title           TEXT NOT NULL,                -- "Maladies inflammatoires chroniques de l'intestin (MICI)"
  specialty       TEXT NOT NULL,                -- "hépato-gastro-entérologie"
  college_source  TEXT,                         -- "CNGE" / collège name
  keywords        TEXT                          -- optional semicolon-separated
);

CREATE TABLE specialties (
  specialty_id    INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,         -- canonical specialty label
  aliases         TEXT                          -- JSON array or ;-separated
);

-- ---------------------------------------------------------------------------
-- Core chunk store (~40k rows)
-- ---------------------------------------------------------------------------
CREATE TABLE chunks (
  chunk_id        INTEGER PRIMARY KEY,
  item_number     INTEGER NOT NULL REFERENCES items(item_number),
  specialty       TEXT NOT NULL,                -- denormalized for filter speed
  section_path    TEXT NOT NULL,                -- "Complications > Infectieuses"
  section_type    TEXT NOT NULL,                -- controlled enum, see below
  section_level   INTEGER NOT NULL DEFAULT 1,   -- header depth
  header_text     TEXT,                         -- immediate section header
  chunk_text      TEXT NOT NULL,                -- body text
  chunk_order     INTEGER NOT NULL DEFAULT 0,   -- order within item
  page_ref        TEXT,                         -- optional collège page / PDF ref
  token_count     INTEGER,
  -- Precomputed lexical helpers for hop extraction (optional but useful)
  has_complication_cue INTEGER NOT NULL DEFAULT 0,  -- 1 if text matches cue list
  has_treatment_cue    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Controlled section_type vocabulary (enforce in ETL):
-- general, definition, epidemiologie, physiopathologie, diagnostic,
-- clinique, biologie, imagerie, complications, evolution, pronostic,
-- traitement, prise_en_charge, conduite_a_tenir, prevention,
-- surveillance, diagnostic_differentiel, facteurs_de_risque, other

CREATE INDEX idx_chunks_item ON chunks(item_number);
CREATE INDEX idx_chunks_specialty ON chunks(specialty);
CREATE INDEX idx_chunks_section_type ON chunks(section_type);
CREATE INDEX idx_chunks_item_section ON chunks(item_number, section_type);
CREATE INDEX idx_chunks_cues ON chunks(has_complication_cue, has_treatment_cue);

-- ---------------------------------------------------------------------------
-- FTS5 virtual table (external content)
-- Searchable: header + path + body. Metadata filters via JOIN to chunks.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  header_text,
  section_path,
  chunk_text,
  content = 'chunks',
  content_rowid = 'chunk_id',
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Keep FTS in sync (ETL bulk load can rebuild; triggers for incremental)
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, header_text, section_path, chunk_text)
  VALUES (new.chunk_id, new.header_text, new.section_path, new.chunk_text);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, header_text, section_path, chunk_text)
  VALUES ('delete', old.chunk_id, old.header_text, old.section_path, old.chunk_text);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, header_text, section_path, chunk_text)
  VALUES ('delete', old.chunk_id, old.header_text, old.section_path, old.chunk_text);
  INSERT INTO chunks_fts(rowid, header_text, section_path, chunk_text)
  VALUES (new.chunk_id, new.header_text, new.section_path, new.chunk_text);
END;

-- ---------------------------------------------------------------------------
-- Entity lexicon for anchors + bridge validation (offline curated + mined)
-- ---------------------------------------------------------------------------
CREATE TABLE entities (
  entity_id       INTEGER PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  entity_type     TEXT NOT NULL,  -- disease, complication, drug, procedure, symptom
  item_number     INTEGER REFERENCES items(item_number),  -- primary item if any
  specialty       TEXT,
  -- Optional structured links for multi-hop without LLM
  parent_entity_id INTEGER REFERENCES entities(entity_id)
);

CREATE UNIQUE INDEX idx_entities_canonical ON entities(canonical_name);

CREATE TABLE entity_aliases (
  alias_id        INTEGER PRIMARY KEY,
  entity_id       INTEGER NOT NULL REFERENCES entities(entity_id),
  alias           TEXT NOT NULL,
  alias_norm      TEXT NOT NULL          -- lowercased, de-accented key
);

CREATE INDEX idx_alias_norm ON entity_aliases(alias_norm);

-- Explicit relation edges mined from collège text or curated (huge win for hop1)
CREATE TABLE entity_relations (
  rel_id          INTEGER PRIMARY KEY,
  subject_id      INTEGER NOT NULL REFERENCES entities(entity_id),  -- e.g. Crohn
  object_id       INTEGER NOT NULL REFERENCES entities(entity_id),  -- e.g. fistule
  relation_type   TEXT NOT NULL,   -- complication_of, frequent_complication, cause_of, ...
  frequency_rank  INTEGER,         -- 1 = most frequent if known
  evidence_chunk_id INTEGER REFERENCES chunks(chunk_id),
  confidence      REAL NOT NULL DEFAULT 0.5,
  UNIQUE(subject_id, object_id, relation_type)
);

CREATE INDEX idx_rel_subject ON entity_relations(subject_id, relation_type, frequency_rank);

-- ---------------------------------------------------------------------------
-- Synonyms for query expansion (static)
-- ---------------------------------------------------------------------------
CREATE TABLE term_synonyms (
  syn_id          INTEGER PRIMARY KEY,
  canonical       TEXT NOT NULL,
  variant         TEXT NOT NULL,
  lang            TEXT DEFAULT 'fr'
);

CREATE INDEX idx_syn_canonical ON term_synonyms(canonical);
CREATE INDEX idx_syn_variant ON term_synonyms(variant);

-- ---------------------------------------------------------------------------
-- Query / hop telemetry + optional cache (Worker-friendly)
-- ---------------------------------------------------------------------------
CREATE TABLE query_cache (
  q_hash          TEXT PRIMARY KEY,
  q_norm          TEXT NOT NULL,
  hop_plan_json   TEXT,            -- serialized hop queries + bridges
  result_chunk_ids TEXT,           -- JSON array
  created_at      TEXT DEFAULT (datetime('now')),
  hit_count       INTEGER DEFAULT 0
);

CREATE TABLE hop_logs (
  log_id          INTEGER PRIMARY KEY,
  q_hash          TEXT,
  hop_index       INTEGER,
  fts_query       TEXT,
  filters_json    TEXT,
  top_chunk_ids   TEXT,
  bridge_json     TEXT,
  latency_ms      INTEGER,
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### 3.3 How metadata powers filtered hops

| Filter | When applied | Hop | Effect |
|--------|--------------|-----|--------|
| `item_number = ?` | Anchor maps to unique EDN item | 1 & 2 | Prevents cross-item pollution |
| `specialty = ?` | Item unknown but specialty known | 1 | Medium precision boost |
| `section_type IN ('complications',…)` | Hop 1 relation resolve | 1 | Hits naming of complication |
| `section_type IN ('traitement','prise_en_charge','conduite_a_tenir')` | After bridge known | 2 | Hits management text |
| `has_complication_cue = 1` | Weak hop-1 | 1 | Cheap prefilter |
| `has_treatment_cue = 1` | Weak hop-2 | 2 | Cheap prefilter |
| `entity_relations` lookup | If edge exists with `frequency_rank=1` | 0–1 | **Skip FTS hop-1** or use as prior; still verify with evidence chunk |

**Filtered hop pattern (SQL shape):**

```sql
SELECT c.chunk_id, c.item_number, c.section_type, c.section_path,
       c.header_text, c.chunk_text,
       bm25(chunks_fts) AS rank
FROM chunks_fts
JOIN chunks c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH :fts_query
  AND c.item_number = :item_number          -- optional
  AND c.section_type IN ('complications', 'evolution')  -- hop-dependent
ORDER BY rank
LIMIT 8;
```

If filtered query returns 0 rows within budget, **retry once without section filter**, then without item filter (progressive relaxation).

### 3.4 FTS query hygiene

- Quote multi-word medical entities: `"maladie de crohn"`.
- Use prefix sparingly: `complicat*` (helps *complication/complications/compliquée*).
- Prefer `AND` for precision on multi-hop; avoid huge OR expansions that explode latency.
- Escape FTS5 special chars in user text: `"`, `*`, `(`, `)`.

---

## 4. Worked Example — Concrete SQL & Hop Trace

### 4.1 Invented but plausible chunk data

**Item:** 279 — MICI / Maladie de Crohn — specialty: hépato-gastro-entérologie

| chunk_id | section_type | section_path | chunk_text (excerpt) |
|----------|--------------|--------------|----------------------|
| 101 | definition | Définition | La maladie de Crohn est une MICI pouvant atteindre tout le tube digestif… |
| 102 | clinique | Clinique | Douleurs abdominales, diarrhée chronique, amaigrissement… |
| 103 | **complications** | **Complications > Locales** | **La complication la plus fréquente de la maladie de Crohn est la sténose intestinale** (fibrose pariétale). Fistules et abcès sont également fréquents… |
| 104 | complications | Complications > Fistulisantes | Les fistules (péri-anales, entéro-cutanées)… |
| 105 | **traitement** | **Prise en charge > Sténoses** | **Prise en charge de la sténose intestinale dans la maladie de Crohn :** optimisation médico (anti-TNF, corticoïdes si poussée), dilatation endoscopique si sténose courte accessible, chirurgie (résection limitée / stricturoplastie) si échec, occlusion, ou sténose longue… |
| 106 | traitement | Traitement > Fondamental | Biothérapies, immunosuppresseurs, sevrage tabac… |
| 107 | prise_en_charge | CAT > Poussée | Hospitalisation si critères de gravité… |

**Entities (subset):**

| entity_id | canonical_name | type |
|-----------|----------------|------|
| 1 | maladie de Crohn | disease |
| 2 | sténose intestinale | complication |
| 3 | fistule | complication |

**entity_relations:** `(1, 2, 'frequent_complication', frequency_rank=1, evidence_chunk_id=103)`

**User question:**

> Quelle est la prise en charge de la complication la plus fréquente de la maladie de Crohn ?

### 4.2 Stage 0 — parse

```
anchor_disease = "maladie de Crohn"
item_number    = 279          -- via entities/items join
relation_type  = frequent_complication
task_type      = prise_en_charge
multi_hop      = true
hop_plan       = [1: resolve complication, 2: management of bridge]
```

Optional fast path: if `entity_relations` has `frequency_rank=1` for this disease → **seed bridge** = `sténose intestinale` with conf 0.9, still run hop-1 FTS to attach evidence (or skip to hop-2 if evidence_chunk trusted). Below we show full FTS hop-1.

### 4.3 Hop 1 — query & SQL

**Hop-1 FTS query string (`:fts_q1`):**

```
("maladie de crohn" OR crohn) AND (complication OR complications OR complicat*) AND (frequente OR frequentes OR "plus frequente" OR principale)
```

(With `remove_diacritics 2`, *fréquente* matches *frequente*.)

**SQL:**

```sql
-- HOP 1: resolve most frequent complication of maladie de Crohn
SELECT
  c.chunk_id,
  c.item_number,
  c.specialty,
  c.section_type,
  c.section_path,
  c.header_text,
  c.chunk_text,
  bm25(chunks_fts) AS rank
FROM chunks_fts
JOIN chunks c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH
  '("maladie de crohn" OR crohn) AND (complication OR complications OR complicat*) AND (frequente OR frequentes OR "plus frequente" OR principale)'
  AND c.item_number = 279
  AND c.section_type IN ('complications', 'evolution', 'pronostic')
ORDER BY rank
LIMIT 8;
```

**Expected top hit:** `chunk_id = 103`, section `complications`, text naming **sténose intestinale**.

**If zero rows** (progressive relaxation):

```sql
-- HOP 1b: drop section filter
SELECT ... 
WHERE chunks_fts MATCH '...'
  AND c.item_number = 279
ORDER BY bm25(chunks_fts)
LIMIT 8;
```

### 4.4 Bridge entity extraction (after hop 1)

From `chunk_id=103` text:

```
"La complication la plus fréquente de la maladie de Crohn est la sténose intestinale (fibrose pariétale)."
```

Regex hit → surface form `sténose intestinale` → entity_id=2, confidence **1.0** (pattern + entity table + item 279).

Secondary candidates: `fistules`, `abcès` (lower conf; not superlative-aligned).

```
bridge_entities = [
  { "name": "sténose intestinale", "entity_id": 2, "confidence": 1.0 }
]
```

### 4.5 Hop 2 — query & SQL

**Hop-2 FTS query string (`:fts_q2`):**

```
("stenose intestinale" OR stenose) AND ("prise en charge" OR traitement OR "conduite a tenir" OR dilatation OR stricturoplastie OR chirurgie)
```

Disease soft OR (optional, helps disambiguate stenosis of other causes):

```
("stenose intestinale" OR stenose) AND (crohn OR "maladie de crohn") AND ("prise en charge" OR traitement OR dilatation OR stricturoplastie)
```

**SQL:**

```sql
-- HOP 2: management of bridge entity (sténose intestinale)
SELECT
  c.chunk_id,
  c.item_number,
  c.section_type,
  c.section_path,
  c.header_text,
  c.chunk_text,
  bm25(chunks_fts) AS rank
FROM chunks_fts
JOIN chunks c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH
  '("stenose intestinale" OR stenose) AND (crohn OR "maladie de crohn") AND ("prise en charge" OR traitement OR dilatation OR stricturoplastie OR chirurgie)'
  AND c.item_number = 279
  AND c.section_type IN ('traitement', 'prise_en_charge', 'conduite_a_tenir')
ORDER BY rank
LIMIT 8;
```

**Expected top hit:** `chunk_id = 105` — dilatation endoscopique, stricturoplastie, optimisation médico, chirurgie limitée.

### 4.6 Merge / pack for answer generation

```sql
-- Optional: fetch hop-1 evidence + hop-2 answer chunks in one pack
SELECT c.*, s.hop_source, s.hop_rank
FROM chunks c
JOIN (
  SELECT 103 AS chunk_id, 1 AS hop_source, 1 AS hop_rank
  UNION ALL
  SELECT 105, 2, 1
) s ON s.chunk_id = c.chunk_id
ORDER BY s.hop_source, s.hop_rank;
```

**Context pack sent to answer model (or extractive QA):**
1. Bridge evidence (103): names sténose as most frequent complication.  
2. Management (105): PEC of sténose in Crohn.

**Stopping:** hop=2 complete, bridge conf≥0.5, hop-2 non-empty → **stop**.

### 4.7 Why single-shot BM25 fails here (contrast)

Single-shot on full Q tends to MATCH strongly on *prise en charge* + *Crohn* → chunks **106/107** (general treatment / CAT poussée) **without** resolving *which* complication. Multi-hop forces the intermediate entity into the second query.

---

## 5. Failure Modes of This Design — and Mitigations

### Failure mode 1 — Wrong bridge entity (complication list vs “most frequent”)

**Symptom:** Hop 1 retrieves a complications section that lists fistules, abcès, sténoses without a clear superlative; extractor picks the **first bullet** (e.g. fistule) instead of the true “plus fréquente” (sténose). Hop 2 then answers the wrong complication’s management.

**Why it happens:** Superlative language absent or split across chunks; regex prefers first NP; BM25 ranks a long list chunk high for *complication* without *plus fréquente* alignment.

**Mitigations:**
1. **Superlative-aware scoring:** boost chunks containing `(plus )?fréquente|principale|majeure` near `complication` (SQL: require those terms in MATCH; post-rank by cue proximity window).  
2. Prefer **entity_relations.frequency_rank = 1** when curated/mined; use FTS only as evidence confirmation.  
3. Keep **top-3 bridge candidates**; run hop-2 for best, and if answer model (or extractive check) finds inconsistency, try candidate #2.  
4. Split long list chunks in ETL so each complication is its own chunk with local headers.  
5. If no superlative match, return **hedged multi-bridge pack** (“complications fréquentes: A, B, C — PEC de chacune”) rather than a false single answer.

### Failure mode 2 — Metadata over-filtering (empty hop)

**Symptom:** Correct item_number or section_type filter yields **0 rows** because ETL mislabeled `section_type` (e.g. complications buried under `clinique` or `evolution`), or disease discussed under a different item number.

**Why it happens:** Collège structures vary; denormalized specialty/item errors; hard filters too strict.

**Mitigations:**
1. **Progressive relaxation ladder** within the same hop budget:  
   `(item ∧ section) → (item only) → (specialty ∧ section) → (unfiltered FTS)`.  
2. Dual-write section labels: primary `section_type` + free-text `section_path` still in FTS.  
3. Cap filter strictness time: if first query returns 0 in <30 ms, immediately relax (still total <200 ms).  
4. ETL QA: measure % of items with at least one `complications` and one `traitement` chunk; fix gaps.  
5. Soft boost instead of hard filter on first attempt when item mapping confidence < 1.0.

### Failure mode 3 — Lexical mismatch / synonym gap (bridge or disease)

**Symptom:** Hop 1 fails because the collège says *« sténoses fibreuses »* or *« rétrécissement iléal »* while the question/templates look for *complication la plus fréquente*; or hop 2 query uses `sténose intestinale` but management chunk only says *« dilatation des sténoses iléales »*. Single-entity phrasing never co-occurs.

**Why it happens:** No embeddings; pure BM25 needs term overlap; French medical synonymy is rich; abbreviations (MICI vs Crohn).

**Mitigations:**
1. Maintain **term_synonyms** + **entity_aliases** expanded at query time (controlled OR groups, max 3–5 variants to protect latency).  
2. **Prefix tokens** carefully: `stenos*` matches sténose/sténoses/sténosant.  
3. Mine aliases from parentheses and “ou” appositions in corpus offline: `sténose intestinale (fibrose pariétale)`.  
4. Hop-2 query: AND bridge **core lemma** + management cues; OR full phrase — e.g. `(stenos* OR "retrecissement ileal") AND (dilatation OR stricturoplastie OR "prise en charge")`.  
5. Use **item pin** so even partial term overlap ranks the right chapter.  
6. Optional: offline **relation graph** (`entity_relations`) so hop-1 can resolve bridge by structured lookup when text wording diverges from Q templates.  
7. Log miss queries; weekly lexicon update from failed EDN bank items (still offline, no external service at query time).

---

## 6. Implementation Checklist (concise)

1. ETL 40k chunks → `chunks` + triggers → `chunks_fts`; normalize `section_type`.  
2. Build `entities`, `entity_aliases`, seed high-value `entity_relations` (frequent complications).  
3. Stage 0 multi-hop detector + FR medical normalizer in Worker.  
4. Hop executor with 200 ms timeout, progressive filters, BM25 top-8.  
5. Bridge extractor: regex suite + entity validation.  
6. Hop-2 management templates; pack hop-1 evidence + hop-2 answer.  
7. Telemetry in `hop_logs`; cache frequent EDN questions.  
8. Default path = pure lexical; LLM reformulator only as fallback behind confidence gate.

---

## 7. Summary

This pipeline turns nested EDN questions into a **two-hop BM25 plan**: hop 1 retrieves and extracts the **bridge entity** (e.g. most frequent complication of disease X) using relation-focused lexical queries and section/item filters; hop 2 retrieves **prise en charge** for that entity. The SQLite schema separates content, FTS5 index, entities, and optional relation edges so filtered hops stay within **<200 ms** without embeddings or external services. Pure lexical reformulation meets the latency budget; a small LLM reformulator improves paraphrase robustness but should stay off the hot path except as a gated fallback. Explicit failure modes—wrong bridge, over-filtering, synonym gaps—are mitigated by progressive relaxation, superlative-aware extraction, synonym/relation tables, and multi-candidate bridges.
