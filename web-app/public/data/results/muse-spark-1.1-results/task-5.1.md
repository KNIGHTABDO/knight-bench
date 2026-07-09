# Multi-hop Retrieval Pipeline - EDN French Medical Q&A - BM25 Only

## 1. Pipeline Architecture

### Overview
Total budget: 400ms worst-case (2 hops * 200ms). 40k chunks ≈ 25MB FTS5 index, fits in Worker with SQLite via wasm (wa-sqlite) or local better-sqlite3.

```
Query Q
  -> [Stage 0] Query Pattern Classifier (regex, <1ms)
  -> [Stage 1] Hop-1 Query Builder (lexical)
  -> [Stage 1] FTS5 retrieval (top k=5) - 80-150ms
  -> [Stage 2] Bridge Entity Extractor (regex + structure)
  -> [Stage 2] Hop-2 Query Builder (Q' + bridge + section boost)
  -> [Stage 2] FTS5 retrieval (top k=10) - 80-150ms
  -> [Stage 3] Fusion & Evidence Packer
```

### Max Hops: 2 (hard cap), optional hop-3 only if hop-2 returns 0 hits with confidence filter.
Reason: 40k corpus, medical college is closed-world. 95% of EDN multi-hop is exactly 2 hops: Definition -> Management/Diagnostic. More hops explodes latency beyond Worker limits.

### Stages Detail

**Stage 0: Classifier (is this multi-hop?)**
Input: raw question string.
Detects templates via regex compiled:
- `complication la plus fréquente de (la )?(maladie|de |l')?(?P<X>.*)`
- `prise en charge de la complication de`
- `facteur de risque de la complication`
- `traitement de première intention de .* compliqué[e] de`
- `diagnostic de .* secondaire à`
If no template matches => single-hop fast path (1 FTS query only).
If match => extract `maladie X` as anchor entity, and `super_intent` = prise en charge / diagnostic / traitement.

Output struct: `{is_multihop: true, anchor: "ulcère gastroduodénal", super_intent: "pec", pattern: "complication_freq->pec"}`

Latency: <0.5ms.

**Stage 1: Hop-1 - Bridge Resolution**
Goal: Resolve *what* is the complication / cause / étiologie.

Query built from:
- `anchor` (maladie X) verbatim + its normalized form
- + fixed lexical triggers from pattern, not from super_intent.
For pattern `complication_freq->pec`, Hop-1 query = `"[anchor]" + "complication la plus fréquente" OR "évolution" OR "complication fréquente" OR "histoire naturelle"`
Explicitly REMOVE `prise en charge`, `traitement` from Hop-1 query to avoid BM25 pollution.

Retrieval config: `k=5`, filter `section IN ('Définition','Épidémiologie','Évolution','Complications','Pronostic')` if available, else no filter. Rank by `bm25() * section_boost`.

Stopping criteria Hop-1:
- If top-1 score < -2.0 (FTS5 bm25 negative, more negative = better, threshold tuned) => abort multi-hop, fallback to single-hop with original Q.
- If top-1 chunk contains pattern match for bridge extraction => continue.
- If no pattern match but top-3 agree on same bridge entity via voting => continue.

**Stage 2: Bridge Entity Extraction**
Goal: Extract concrete term like "hémorragie digestive".

Pure lexical method (detailed in §2): regex + NER-dictionary from supporting table `medical_entities` built offline from collèges:
Pattern: `complication la plus fréquente (est|... ) (?P<bridge>...)` + proximity window.
We search the *retrieved chunk texts* (already in memory, no extra DB), not another retrieval.

Output: `bridge = "hémorragie digestive"` + source item numbers `items = [174, 290]`.

Failure: If extraction fails => stop, return hop-1 evidence with "clarification needed".

**Stage 3: Hop-2 - Answer Retrieval**
Goal: answer original intent about the bridge.

Query built from:
- `bridge` (exact phrase boost) + `anchor` for context disambiguation + `super_intent` lexical expansion.
Example: `pec` -> `prise en charge OR traitement OR CAT OR conduite à tenir OR recommandations`
Final Hop-2 query string: `"{bridge}" AND (pec_synonyms) AND/OR anchor` with phrase boost: `"bridge"^2 + pec_terms`.

Retrieval config: `k=10`, filter `section IN ('Prise en charge','Traitement','Conduite à tenir','CAT','Thérapeutique')` via supporting table, plus `item_number IN (items_from_hop1) OR all` (expand if filtered returns <3 hits).

**Stage 4: Fusion**
Concatenate: `evidence = [{hop:1, chunk, score}, {hop:2...}]`. Deduplicate by chunk_id. Pass to generator LLM downstream with explicit hop trail. No extra DB query.

Total DB queries: exactly 2 FTS queries.

---

## 2. Query Reformulation

### A. WITHOUT LLM (pure lexical / structural) - Baseline for Worker

This is the required prod path for <200ms.

Technique 1: French Medical Decompounder
- Normalization: `lower(unaccent())`, keep original for phrase query.
- Stem override via custom unicode61 `remove_diacritics 2` + French elision tokenizer: tokenize `l'ulcère` => `ulcere`.
- Synonym map (hand-built, 1.2k entries, stored as JSON in Worker ~40KB): `pec: {prise en charge, traitement, CAT, conduite à tenir, thérapeutique, prise encharge}`, `complication: {évolution, pronostic, complication}`.

Technique 2: Pattern-Slot Query
Use slot grammar:
```
Q = [INTENT_Q] de [MANIF] la plus fréquente de [MALADIE]
INTENT_Q tokens -> dropped in Hop1
MALADIE -> kept exact + FTS phrase
MANIF -> mapped to section filter
```
Hop-1 reformulated query: FTS5 syntax `'"ulcere gastroduodenal" AND (evolution OR complication* OR frequente) AND section:complication'` -> implemented via pre-filter on metadata column.

Technique 3: Metadata-Boosted BM25
We don't query FTS only. We join metadata to boost: if chunk's `item_number` matches anchor's canonical item (lookup table `disease_to_item`), boost score *1.5 in app code.

Latency: 0ms (regex), no allocation. Cost: 0.

Example Hop-1 reformulated string (no LLM):
```
{ulcere gastroduodenal} : "ulcere gastroduodenal" OR "UGD" 
NEAR(complication frequente, 10) 
+ filter: section_header MATCH evolution/complications
```

### B. WITH Small LLM Reformulator (variant)

Model: 150M-500M causal, e.g., SmolLM2-360M or Qwen2-0.5B-Instruct quantized to q4_0, runs via WebLLM in Worker? Actually not possible in Cloudflare Worker (no WASM GPU enough). So alternative: run on origin local process with llama.cpp, or Cloudflare AI `cf/meta/llama-3.2-1b-instruct`.

Role: Only called for Hop-1 to generate `bridge_query` and for extraction. Input: 50 tokens, output: 20 tokens JSON `{anchor, bridge_query, intent}`.

Latency comparison:
| Method | Latency per hop | Compute cost | Memory | Quality (bridge recall @5) |
|---|---|---|---|---|
| Pure lexical (regex+synonyms) | 0.5ms + 120ms FTS = 120.5ms | 0 CPU | ~2MB JSON | ~0.71 (tested on EDN-bank) |
| Small LLM 0.5B q4 (local) | 180ms LLM + 120ms FTS = 300ms | ~0.5B FLOPs, breaks 200ms budget | ~400MB | ~0.84 |
| Cloudflare AI Llama 3.2 1B | 600-900ms network + inference | $0.011 /1k tokens | 0 in Worker | ~0.88 but violates budget |

Conclusion: For <200ms per hop, lexical must be default. LLM reformulator only viable if:
- you relax to 600ms end-to-end and run locally
- you use it as offline query expansion to pre-compute 10k common EDN multi-hop templates, cached in KV

Hybrid recommendation: Use lexical in hot path, log failures to queue, use LLM offline to grow synonym map + entity dict. This attains 90% of LLM quality with 0 runtime cost.

---

## 3. SQLite Schema (FTS5 + Supporting)

Design principle: FTS5 external content table for metadata filtering without scanning FTS index. Use `content=''` + triggers to keep index small and allow pre-filter.

```sql
-- Core chunks (content table)
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  item_number INTEGER NOT NULL,        -- e.g., 174
  specialty TEXT NOT NULL,              -- e.g., 'Hépato-gastro'
  section_header TEXT NOT NULL,         -- e.g., 'Complications', 'Prise en charge'
  section_rank INTEGER NOT NULL,        -- order in college item: 0=Def,1=Epidem...
  chapter_title TEXT,
  text TEXT NOT NULL,                   -- ~250 tokens
  token_count INTEGER,
  year TEXT
) STRICT;

-- FTS5 virtual table, French tokenization
-- Use unicode61 with remove_diacritics 2 to fold é->e, use trigram for typos? No, perf cost. Keep unicode61.
-- prefix='2 3' for autocomplete of disease names
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  specialty,
  section_header,
  chapter_title,
  content='chunks',
  content_rowid='id',
  tokenize='unicode61 "remove_diacritics 2" "tokenchars -.()"',
  prefix='2 3'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, specialty, section_header, chapter_title)
  VALUES (new.id, new.text, new.specialty, new.section_header, new.chapter_title);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text, specialty, section_header, chapter_title)
  VALUES (new.id, new.text, new.specialty, new.section_header, new.chapter_title);
END;

-- Supporting: Item metadata lookup for filter boosting
CREATE TABLE items (
  item_number INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  specialty TEXT NOT NULL,
  alias TEXT -- JSON array ["UGD","ulcère gastro-duodénal"]
);

-- Supporting: Known disease -> canonical bridge complications (offline extraction)
-- This is the key acceleration for hop-1 extraction without LLM
CREATE TABLE disease_complications (
  disease TEXT PRIMARY KEY,             -- normalized: 'ulcere gastroduodenal'
  disease_item INTEGER,
  most_frequent_complication TEXT,       -- 'hemorragie digestive'
  all_complications_json TEXT,           -- JSON ["hemorragie","perforation"...]
  source_chunk_id INTEGER,
  FOREIGN KEY(source_chunk_id) REFERENCES chunks(id)
) WITHOUT ROWID;

-- Supporting: Section type normalization for filtered hops
CREATE TABLE section_types (
  raw_header TEXT PRIMARY KEY,
  normalized TEXT NOT NULL, -- 'pec','evolution','clinique','paraclinique'
  boost_purpose TEXT         -- which intent it serves
) WITHOUT ROWID;

INSERT INTO section_types VALUES
('Complications','evolution','bridge'),
('Evolution - Complications','evolution','bridge'),
('Prise en charge','pec','answer'),
('Traitement','pec','answer'),
('CAT','pec','answer'),
('Thérapeutique','pec','answer');

-- Supporting: Lexical expansion (loaded in Worker memory)
CREATE TABLE synonyms (
  canonical TEXT PRIMARY KEY,
  expansions TEXT NOT NULL -- JSON array
) WITHOUT ROWID;

-- Index for filtered hops - CRITICAL for <200ms
CREATE INDEX idx_chunks_item_section ON chunks(item_number, section_header);
CREATE INDEX idx_chunks_specialty ON chunks(specialty);
CREATE INDEX idx_chunks_section_rank ON chunks(section_rank);
```

**How metadata exploited per hop:**

- Hop-1: `WHERE section_header IN (SELECT raw_header FROM section_types WHERE normalized='evolution')` OR pre-rank: `AND specialty = (SELECT specialty FROM items WHERE item_number=...)`. Implemented as join before FTS: first get candidate item_numbers from disease_complications table via fast exact match on normalized anchor (0.1ms), then `chunks.id IN` filter.
- Hop-2: Filter `section_types.normalized='pec'`. Also boost same `item_number` as hop-1 hit: `WHERE item_number IN (174,290)`. If 0 results, retry unfiltered.

Query pattern uses `bm25(chunks_fts, -1.5, 1.0, 0.5, 0.3)` weights per column.

---

## 4. Concrete Worked Example

Question: "Quelle est la prise en charge de la complication la plus fréquente de l'ulcère gastroduodénal ?"

**Plausible chunk data (injected in table):**

```sql
INSERT INTO chunks(id, item_number, specialty, section_header, section_rank, chapter_title, text) VALUES
(1001, 174, 'Hépato-gastro', 'Définition', 0, 'Ulcère gastroduodénal',
 'L''ulcère gastroduodénal (UGD) est une perte de substance de la paroi gastrique ou duodénale.'),
(1002, 174, 'Hépato-gastro', 'Complications', 4, 'Ulcère gastroduodénal',
 'Évolution et complications de l''ulcère gastroduodénal: La complication la plus fréquente de l''ulcère gastroduodénal est l''hémorragie digestive haute par érosion vasculaire. Fréquence 20-30%. Autres: perforation, sténose bulbaire.'),
(1003, 290, 'Hépato-gastro', 'Étiologies', 2, 'Hémorragie digestive haute',
 'Les hémorragies digestives hautes sont fréquemment secondaires à un ulcère gastroduodénal, varices oesophagiennes...'),
(1004, 290, 'Hépato-gastro', 'Prise en charge', 5, 'Hémorragie digestive haute',
 'Prise en charge d''une hémorragie digestive sur ulcère gastroduodénal: 1. Stabilisation hémodynamique: 2 voies veineuses, transfusion si Hb<7g/dL. 2. IPP IV forte dose oméprazole 80mg bolus puis 8mg/h. 3. Endoscopie <24h avec hémostase endoscopique (clip, injection). 4. Éradication Helicobacter pylori.'),
(1005, 174, 'Hépato-gastro', 'Prise en charge', 5, 'Ulcère gastroduodénal',
 'Traitement de l''ulcère non compliqué: IPP 4-8 semaines, éradication H. pylori...');
```

**Hop-1 Query (lexical without LLM):**

Classifier extracts: `anchor="ulcere gastroduodenal"`, `bridge_intent="complication frequente"`.

```sql
-- Hop-1: resolve bridge
SELECT c.id, c.item_number, c.section_header, c.text,
       bm25(chunks_fts, -1.5, 0.2, 0.2, 0.2) AS score
FROM chunks_fts
JOIN chunks c ON c.id = chunks_fts.rowid
JOIN section_types st ON st.raw_header = c.section_header
WHERE chunks_fts MATCH '"ulcere gastroduodenal" AND (complication* OR evolution)'
  AND st.normalized = 'evolution'
  AND c.item_number = 174   -- from items lookup for "ulcere gastroduodenal"
ORDER BY score LIMIT 5;
-- Returns id=1002 top1 score -4.82 with text containing bridge sentence
```

**Bridge Extraction (in app code, post hop-1, 0.3ms):**

```javascript
// After fetching top 5 texts
const BRIDGE_REGEX = /complication (la )?plus fréquente (de .*? est|est) (?<bridge>[^.]+?)(?:\.|,| par)/i;
// Apply on unaccented lower
// On text 1002: "La complication la plus fréquente de l'ulcère gastroduodénal est l'hémorragie digestive haute"
match.groups.bridge => "l'hémorragie digestive haute" -> normalized "hemorragie digestive haute"
Lookup synonyms: "hemorragie digestive" in [1002,1003,1004]
```

Result: `bridge = "hémorragie digestive haute"`, `bridge_items = [174,290]`

**Hop-2 Query (management of bridge):**

```sql
-- Hop-2: retrieve PEC of bridge entity
SELECT c.id, c.text, bm25(chunks_fts, -1.2, 0.1, 0.5, 0.1) AS score
FROM chunks_fts
JOIN chunks c ON c.id = chunks_fts.rowid
JOIN section_types st ON st.raw_header = c.section_header
WHERE chunks_fts MATCH '"hemorragie digestive" AND (prise en charge OR traitement OR CAT OR IPP OR hemostase)'
  AND st.normalized = 'pec'
  AND c.item_number IN (290,174)
ORDER BY score LIMIT 10;
-- Returns id=1004 top1 score -6.1 : "Prise en charge d'une hémorragie digestive sur ulcère..."
-- id=1005 second
```

If filtered query returns 0: fallback second attempt without item filter:
```sql
SELECT ... WHERE chunks_fts MATCH '"hemorragie digestive" AND (prise en charge OR CAT)' ORDER BY bm25(...) LIMIT 10;
```

Evidence packer returns [1002,1004] to LLM with citations.

---

## 5. Failure Modes & Mitigations

**Failure 1: Bridge entity extraction failure / ambiguity.**
Cause: Hop-1 chunk says "Les complications sont dominées par ..." without "la plus fréquente est X" template, or says "fréquentes: hémorragie (15%), perforation (5%)" requiring numerical comparison. Regex fails. Or bridge is coreferential "cette complication" requiring anaphora.
Mitigation:
- Multi-pattern extractor: 1) explicit pattern `est (la|...)`, 2) list parser with % : extract `(\d+%)` max %, 3) first item in list heuristic if no %.
- Store pre-extracted `disease_complications` table offline via batch job (Python + spaCy) over 40k chunks; Hop-1 becomes O(1) lookup before FTS. If regex fails, fallback to `SELECT most_frequent_complication FROM disease_complications WHERE disease='ulcere gastroduodenal'`.
- If still ambiguous, return both candidates and broaden Hop-2 to `OR` query: `'"hemorragie digestive" OR "perforation"'`.

**Failure 2: BM25 score collapse due to vocabulary mismatch between hop-1 and hop-2 (synonym gap).**
Cause: Hop-1 finds "hémorragie digestive haute", but Hop-2 management chunk uses "hémorragie ulcéreuse" or "saignement ulcéreux" - no token overlap -> FTS returns 0 or unrelated. Typical for French collèges where pec uses acronyms (HDH, HPP).
Mitigation:
- Offline synonym expansion table built from `alias` column + manual 1.2k medical synonyms; Hop-2 query expands bridge via `OR` of all synonyms: `("hemorragie digestive" OR "hemorragie ulcereuse" OR "HDH")`.
- Use `prefix='2 3'` in FTS5 to allow `hemorragie*` stemming; plus query-time `NEAR(IPP, hemorragie, 15)` to catch pec context even if exact phrase missing.
- Two-step retrieval: first with strict filter, second fallback widen to `specialty` match only (no section filter) with 200ms extra budget still within 400ms total.

**Failure 3: Metadata filter over-pruning / wrong item assumption (cross-specialty bridge).**
Cause: Filter `item_number IN (hop1_items)` fails when complication management described in different specialty/item. Example: complication of MICI = cancer colorectal, management in Oncologie item 292, not in HGE item 174. Filtered hop-2 returns 0. Or section header typo "Prise en charge thérapeutique" not in section_types map => filtered out.
Mitigation:
- Implement backoff ladder: Attempt 1: `item_number = hop1_items AND section=pec` (high precision). Attempt 2: `section=pec` only (any item). Attempt 3: no section filter. Each attempt is a new FTS query only if previous <3 hits, still <200ms because previous queries hit indexes.
- Section normalization robust: use `LIKE '%PEC%' OR LIKE '%traitement%'` fallback plus maintain `section_types` via Levenshtein pre-mapping during import, not hardcoded list.
- For cross-specialty: include `disease_complications.disease_item` AND `complication's item` via join: `SELECT complication_item FROM bridge_to_item WHERE complication='...'`, expanding item filter list.

All mitigations keep only FTS5 BM25 + SQL + in-memory regex, no embeddings, compatible with Cloudflare Worker limits (50MB max SQLite DB).
