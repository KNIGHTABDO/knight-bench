# Multi-hop retrieval pipeline for a French medical Q&A assistant (EDN exam prep)

## 1. Pipeline architecture

### Problem

The assistant searches about 40,000 chunks from French medical collèges. Each chunk has structured metadata: EDN item number, specialty, section headers, and chunk text. Retrieval is constrained to SQLite FTS5 with BM25 only. There are no embeddings and no external services, and each retrieval hop must fit in a budget of about 200 ms in a Cloudflare Worker or local process.

The failure to solve is a bridge question:

> Quelle est la prise en charge de la complication la plus fréquente de la maladie X ?

A single BM25 search for `prise en charge complication fréquente maladie X` often fails because the evidence is split across two places:

1. A chunk about disease X says what the most frequent complication is.
2. A different chunk, often in another item or specialty, says how that complication is managed.

The pipeline therefore separates bridge resolution from answer retrieval.

### Main stages

1. Normalize the question.
2. Detect whether the question contains a bridge relation.
3. Identify the source entity and possible item/specialty scope.
4. Hop 1: retrieve evidence for the bridge entity.
5. Extract and validate the bridge entity from hop-1 evidence.
6. Hop 2: retrieve answer evidence for the bridge entity and final intent.
7. Optional hop 3: disease-specific reconciliation or ambiguity resolution.
8. Return evidence with hop provenance.

### Question frame

For the example question, deterministic parsing should produce:

```text
source_entity = maladie X
bridge_type = complication
bridge_selector = most_frequent
bridge_relation = most_frequent_complication
final_intent = management
```

The system distinguishes:

- source entity: the disease/syndrome in the original question;
- bridge entity: the hidden intermediate entity to resolve;
- final intent: management, treatment, diagnosis, surveillance, prevention, etc.

### Normalization

At ingestion and query time:

- lowercase;
- remove or normalize accents for searchable fields;
- normalize apostrophes and hyphens;
- keep original text for display;
- expand curated abbreviations when safe: `pec` -> `prise en charge`, `cat` -> `conduite a tenir`, `ttt` -> `traitement`;
- remove low-value interrogative words for query construction, while preserving relation words.

### Bridge-pattern detection

Use deterministic templates such as:

```text
prise en charge de la complication la plus frequente de <X>
traitement de la complication principale de <X>
diagnostic de la cause la plus frequente de <X>
germe le plus frequent dans <X>
complication redoutee de <X>
prevention de la complication de <X>
```

If no bridge pattern is detected, the system falls back to normal single-hop BM25 retrieval.

### Metadata scoping before hop 1

Before hop 1, try to map the source entity to EDN metadata using local tables:

- exact alias lookup;
- title/header FTS match;
- known entity-to-item mapping;
- specialty mapping.

If `maladie X` maps to item 210 and specialty `medecine interne`, hop 1 is initially filtered to that item and relation-compatible sections. If mapping confidence is low, use global retrieval but boost matching section headers and specialty hits.

### Hop 1: bridge retrieval

Hop 1 answers:

> What is the most frequent complication of disease X?

Build the hop-1 FTS query from:

- source entity aliases: `maladie x`, known synonyms, acronyms;
- bridge terms: `complication`, `complications`;
- selector terms: `frequente`, `plus frequente`, `principale`, `premiere`, `habituel`, depending on the detected relation;
- metadata filters or boosts: item number, specialty, and section kind.

The first query should be relatively strict:

```text
(source aliases) AND (complication terms) AND (frequency/selector terms)
```

Use `K1 = 8` to `12` results. Prefer section kinds such as:

```text
complications, evolution, prognosis, surveillance, misc
```

Ranking is BM25 plus deterministic metadata boosts. In FTS5, lower BM25 is better, so boosts are subtracted from the score.

### Bridge extraction

Extract the bridge entity from the top hop-1 chunks using high-precision lexical patterns and local entity aliases.

Examples:

```text
la complication la plus frequente est <ENTITY>
<ENTITY> est la complication la plus frequente
principale complication : <ENTITY>
complication principale = <ENTITY>
```

Candidate scoring uses:

- proximity to relation terms;
- whether the candidate matches a known entity alias;
- whether the relation phrase has the right selector, e.g. `plus frequente`, not `plus grave`;
- whether the candidate appears in multiple top chunks;
- whether the section kind is compatible with the relation;
- whether the candidate is specific enough, not merely `infection` or `douleur` unless the corpus clearly supports it.

Proceed to hop 2 when one bridge candidate is confident enough.

Suggested threshold:

```text
bridge_confidence >= 0.70
```

Or accept the bridge if it is extracted by a high-precision pattern and resolves to an entity alias.

### Hop 2: answer retrieval

Hop 2 answers:

> What is the management of the resolved bridge entity?

Build the hop-2 query from:

- bridge entity canonical label and aliases;
- final-intent terms, for management: `prise en charge`, `traitement`, `therapeutique`, `conduite a tenir`, `cat`, `mesures`, `hospitalisation`, `surveillance`;
- bridge item/specialty if known;
- management-compatible section kinds.

Important: source disease terms should usually be optional in hop 2. The management chunk for the complication may not mention disease X.

Use `K2 = 8` to `12` results. Prefer sections:

```text
management, treatment, surveillance, prevention, misc
```

### Optional hop 3

Use at most one extra hop. Recommended maximum:

```text
max_hops = 3
```

Hop 3 is only for low-confidence or disease-specific cases:

1. Source-constrained management:

```text
source_entity + bridge_entity + management_terms
```

2. Second bridge candidate:

```text
second_best_bridge + management_terms
```

3. Parent-disease reconciliation:

```text
source_item + bridge_entity + traitement/prise en charge
```

Do not keep hopping. If hop 3 still fails, return low-confidence evidence or state that retrieval did not find enough support.

### Stopping criteria

Stop after hop 1 and run hop 2 if:

- a high-precision extraction pattern identifies a bridge entity;
- the candidate exists in the alias/entity table;
- the same candidate appears in multiple hop-1 chunks; or
- the bridge confidence is above threshold.

Stop after hop 2 and return evidence if:

- a top chunk mentions the bridge entity or alias;
- the section kind matches the final intent;
- the text contains action terms relevant to the intent;
- the result is sufficiently separated from unrelated chunks.

Fallback behavior:

- if no bridge pattern is detected, use single-hop retrieval;
- if the bridge is ambiguous, run hop 2 for the top two candidates if latency allows;
- if answer retrieval is weak, relax filters in a fixed order rather than guessing.

## 2. Query reformulation strategy

## 2.1 Without an LLM in hop 1

This is the default low-latency design.

### Deterministic components

1. Relation template parser

Map French question patterns to relation frames:

```text
"complication la plus frequente de X" -> most_frequent_complication(source=X)
"cause la plus frequente de X" -> most_frequent_cause(source=X)
"germe le plus frequent de X" -> most_frequent_pathogen(source=X)
"prise en charge de la complication de X" -> management(complication_of=X)
```

2. Intent lexicon

```text
management: prise en charge, pec, conduite a tenir, cat, traitement, therapeutique, mesures
complication: complication, complications, evolutif, evolution, pronostic
frequency: frequent, frequente, plus frequent, plus frequente, principal, principale, premiere
```

3. Entity alias table

Use curated and ingestion-derived aliases:

```text
maladie de Basedow -> basedow, hyperthyroidie auto immune
pericardite aigue -> pericardite, pericardite aigue
```

4. Section-kind mapping

During ingestion, map headers to coarse kinds:

```text
"Evolution et complications" -> complications
"Prise en charge" -> management
"Traitement" -> treatment
"Surveillance" -> surveillance
```

### Hop-1 reformulation

For the example:

```text
question = Quelle est la prise en charge de la complication la plus fréquente de la maladie X ?
source = maladie x
relation = most_frequent_complication
```

Build:

```text
("maladie x") AND (complication OR complications) AND (frequente OR principal OR principale OR premiere)
```

If no results, relax in order:

1. keep source + complication, remove selector;
2. keep source + selector, remove strict item filter;
3. search source within complication/evolution sections;
4. search aliases of source only, restricted to the likely item/specialty.

### Pros

- no model cost;
- deterministic and auditable;
- works in Cloudflare Worker or local SQLite;
- predictable latency;
- easier to evaluate on EDN benchmark questions.

### Cons

- template coverage must be maintained;
- paraphrases can be missed;
- source entity boundary detection can fail in long stems;
- synonym gaps hurt recall.

Expected latency for hop 1 over 40k chunks:

```text
query parsing: < 2-5 ms
FTS5 retrieval: often 5-40 ms locally, environment-dependent in Workers
bridge extraction over top 10 chunks: < 2 ms
target: < 200 ms
```

## 2.2 With a small LLM reformulator

The LLM must not answer. It only outputs a constrained retrieval plan. Retrieval and bridge validation remain evidence-based.

Example output:

```json
{
  "source_entity": "maladie X",
  "bridge_relation": "most_frequent_complication",
  "final_intent": "management",
  "hop1_terms": ["maladie X", "complication", "plus frequente", "principale"],
  "hop2_intent_terms": ["prise en charge", "traitement", "conduite a tenir", "surveillance"]
}
```

Validate the JSON against a schema. Reject unsupported relation types. Do not accept a bridge entity from the LLM unless hop 1 retrieves textual evidence for it.

### Comparison

Deterministic reformulator:

```text
Cost: zero model cost
Latency: usually 10-60 ms including hop-1 retrieval
Best for: Worker deployment, high volume, auditability
Weakness: brittle on unusual phrasing
```

Small LLM reformulator:

```text
Cost: token/runtime cost per uncached question
Latency: adds roughly 30-300 ms depending on model and hosting
Best for: long or varied user questions, local process with relaxed latency
Weakness: schema validation and hallucination controls required
```

Recommended design:

- deterministic path first;
- small LLM only when deterministic confidence is low, or in a local process where extra latency is acceptable;
- cache reformulation by normalized question hash;
- never let the LLM bypass retrieval evidence.

## 3. Exact SQLite schema

The design uses a normal `chunks` table for metadata and an external-content FTS5 table for searchable text. Metadata is duplicated into FTS columns for lexical matching and also stored in ordinary indexed columns for filtering.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE items (
  item_id INTEGER PRIMARY KEY,
  item_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  specialty TEXT NOT NULL,
  specialty_norm TEXT NOT NULL,
  UNIQUE(item_number, title_norm, specialty_norm)
);

CREATE TABLE chunks (
  chunk_id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  item_number INTEGER NOT NULL,
  specialty TEXT NOT NULL,
  specialty_norm TEXT NOT NULL,
  section_path TEXT NOT NULL,
  section_path_norm TEXT NOT NULL,
  section_kind TEXT NOT NULL,
  chunk_ordinal INTEGER NOT NULL,
  title TEXT,
  title_norm TEXT,
  chunk_text TEXT NOT NULL,
  chunk_text_norm TEXT NOT NULL,
  token_count INTEGER,
  source_ref TEXT
);

CREATE INDEX idx_chunks_item ON chunks(item_id, chunk_ordinal);
CREATE INDEX idx_chunks_item_number ON chunks(item_number);
CREATE INDEX idx_chunks_specialty ON chunks(specialty_norm);
CREATE INDEX idx_chunks_section_kind ON chunks(section_kind);
CREATE INDEX idx_chunks_item_section ON chunks(item_number, section_kind);
```

FTS5 table:

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  title_norm,
  specialty_norm,
  section_path_norm,
  section_kind,
  chunk_text_norm,
  content='chunks',
  content_rowid='chunk_id',
  tokenize='unicode61 remove_diacritics 2'
);
```

Synchronization triggers:

```sql
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(
    rowid,
    title_norm,
    specialty_norm,
    section_path_norm,
    section_kind,
    chunk_text_norm
  ) VALUES (
    new.chunk_id,
    coalesce(new.title_norm, ''),
    new.specialty_norm,
    new.section_path_norm,
    new.section_kind,
    new.chunk_text_norm
  );
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(
    chunks_fts,
    rowid,
    title_norm,
    specialty_norm,
    section_path_norm,
    section_kind,
    chunk_text_norm
  ) VALUES (
    'delete',
    old.chunk_id,
    coalesce(old.title_norm, ''),
    old.specialty_norm,
    old.section_path_norm,
    old.section_kind,
    old.chunk_text_norm
  );
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(
    chunks_fts,
    rowid,
    title_norm,
    specialty_norm,
    section_path_norm,
    section_kind,
    chunk_text_norm
  ) VALUES (
    'delete',
    old.chunk_id,
    coalesce(old.title_norm, ''),
    old.specialty_norm,
    old.section_path_norm,
    old.section_kind,
    old.chunk_text_norm
  );

  INSERT INTO chunks_fts(
    rowid,
    title_norm,
    specialty_norm,
    section_path_norm,
    section_kind,
    chunk_text_norm
  ) VALUES (
    new.chunk_id,
    coalesce(new.title_norm, ''),
    new.specialty_norm,
    new.section_path_norm,
    new.section_kind,
    new.chunk_text_norm
  );
END;
```

Entity tables:

```sql
CREATE TABLE entities (
  entity_id INTEGER PRIMARY KEY,
  canonical_label TEXT NOT NULL,
  canonical_norm TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'disease',
    'complication',
    'syndrome',
    'diagnosis',
    'pathogen',
    'treatment',
    'procedure',
    'drug',
    'sign',
    'other'
  ))
);

CREATE TABLE entity_aliases (
  alias_id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(entity_id),
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'curated',
  UNIQUE(entity_id, alias_norm)
);

CREATE INDEX idx_entity_alias_norm ON entity_aliases(alias_norm);
CREATE INDEX idx_entities_type ON entities(entity_type);
```

Entity-to-item map:

```sql
CREATE TABLE entity_item_map (
  entity_id INTEGER NOT NULL REFERENCES entities(entity_id),
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  specialty_norm TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  evidence TEXT,
  PRIMARY KEY(entity_id, item_id)
);

CREATE INDEX idx_entity_item_entity ON entity_item_map(entity_id, confidence DESC);
CREATE INDEX idx_entity_item_specialty ON entity_item_map(specialty_norm);
```

Section-kind rules:

```sql
CREATE TABLE section_kind_rules (
  rule_id INTEGER PRIMARY KEY,
  section_kind TEXT NOT NULL,
  pattern_norm TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100
);
```

Typical section kinds:

```text
introduction
physiopathology
epidemiology
diagnosis
complications
management
treatment
surveillance
prevention
prognosis
misc
```

Relation cache:

```sql
CREATE TABLE relation_cache (
  relation_id INTEGER PRIMARY KEY,
  source_entity_id INTEGER NOT NULL REFERENCES entities(entity_id),
  relation_type TEXT NOT NULL,
  target_entity_id INTEGER REFERENCES entities(entity_id),
  target_label TEXT NOT NULL,
  target_norm TEXT NOT NULL,
  evidence_chunk_id INTEGER REFERENCES chunks(chunk_id),
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_entity_id, relation_type, target_norm)
);

CREATE INDEX idx_relation_cache_source
ON relation_cache(source_entity_id, relation_type, confidence DESC);
```

Optional retrieval logs:

```sql
CREATE TABLE retrieval_logs (
  log_id INTEGER PRIMARY KEY,
  question_norm TEXT NOT NULL,
  hop_number INTEGER NOT NULL,
  query_text TEXT NOT NULL,
  filters_json TEXT,
  top_chunk_ids_json TEXT,
  selected_entity_norm TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Metadata-aware ranking

Hop 1 can filter to the source item and relation-compatible sections:

```sql
WHERE chunks_fts MATCH :hop1_match
  AND c.item_number = :source_item_number
  AND c.section_kind IN ('complications', 'prognosis', 'surveillance', 'misc')
```

Hop 2 can filter to answer-compatible sections:

```sql
WHERE chunks_fts MATCH :hop2_match
  AND c.section_kind IN ('management', 'treatment', 'surveillance', 'prevention', 'misc')
```

Example BM25 plus metadata boost:

```sql
ORDER BY
  bm25(chunks_fts, 0.2, 0.6, 1.0, 1.4, 1.0)
  - CASE WHEN c.section_kind IN ('management', 'treatment') THEN 1.8 ELSE 0 END
  - CASE WHEN c.item_number = :preferred_item_number THEN 0.7 ELSE 0 END
ASC
```

The numeric weights should be calibrated on held-out EDN questions. They are deterministic boosts, not embeddings.

## 4. Worked example with concrete SQL

The example uses invented plausible data. Disease `maladie X` has a most frequent complication, `péricardite aiguë`. The management of `péricardite aiguë` lives in a cardiology item.

### Insert example data

```sql
INSERT INTO items (
  item_id,
  item_number,
  title,
  title_norm,
  specialty,
  specialty_norm
) VALUES
  (1, 210, 'Maladie X', 'maladie x', 'Médecine interne', 'medecine interne'),
  (2, 231, 'Péricardite aiguë', 'pericardite aigue', 'Cardiologie', 'cardiologie');

INSERT INTO entities (
  entity_id,
  canonical_label,
  canonical_norm,
  entity_type
) VALUES
  (1, 'Maladie X', 'maladie x', 'disease'),
  (2, 'Péricardite aiguë', 'pericardite aigue', 'complication');

INSERT INTO entity_aliases (alias_id, entity_id, alias, alias_norm, source) VALUES
  (1, 1, 'maladie X', 'maladie x', 'curated'),
  (2, 2, 'péricardite aiguë', 'pericardite aigue', 'curated'),
  (3, 2, 'péricardite', 'pericardite', 'curated');

INSERT INTO entity_item_map (
  entity_id,
  item_id,
  specialty_norm,
  confidence,
  evidence
) VALUES
  (1, 1, 'medecine interne', 1.0, 'item title'),
  (2, 2, 'cardiologie', 1.0, 'item title');
```

```sql
INSERT INTO chunks (
  chunk_id,
  item_id,
  item_number,
  specialty,
  specialty_norm,
  section_path,
  section_path_norm,
  section_kind,
  chunk_ordinal,
  title,
  title_norm,
  chunk_text,
  chunk_text_norm,
  token_count,
  source_ref
) VALUES
  (
    101,
    1,
    210,
    'Médecine interne',
    'medecine interne',
    'Maladie X > Évolution et complications',
    'maladie x evolution complications',
    'complications',
    12,
    'Évolution et complications',
    'evolution complications',
    'La maladie X évolue le plus souvent favorablement. La complication la plus fréquente est la péricardite aiguë, à rechercher devant une douleur thoracique et un frottement péricardique.',
    'la maladie x evolue le plus souvent favorablement la complication la plus frequente est la pericardite aigue a rechercher devant une douleur thoracique et un frottement pericardique',
    31,
    'college-med-interne-item-210'
  ),
  (
    102,
    1,
    210,
    'Médecine interne',
    'medecine interne',
    'Maladie X > Surveillance',
    'maladie x surveillance',
    'surveillance',
    13,
    'Surveillance',
    'surveillance',
    'La surveillance de la maladie X repose sur la clinique, la biologie inflammatoire et la recherche des complications cardiaques.',
    'la surveillance de la maladie x repose sur la clinique la biologie inflammatoire et la recherche des complications cardiaques',
    19,
    'college-med-interne-item-210'
  ),
  (
    201,
    2,
    231,
    'Cardiologie',
    'cardiologie',
    'Péricardite aiguë > Prise en charge',
    'pericardite aigue prise en charge',
    'management',
    7,
    'Prise en charge',
    'prise en charge',
    'La prise en charge de la péricardite aiguë non compliquée associe repos, AINS à dose anti-inflammatoire et colchicine, avec protection gastrique selon le terrain. Une hospitalisation est indiquée en cas de signe de gravité.',
    'la prise en charge de la pericardite aigue non compliquee associe repos ains a dose anti inflammatoire et colchicine avec protection gastrique selon le terrain une hospitalisation est indiquee en cas de signe de gravite',
    33,
    'college-cardio-item-231'
  ),
  (
    202,
    2,
    231,
    'Cardiologie',
    'cardiologie',
    'Péricardite aiguë > Diagnostic',
    'pericardite aigue diagnostic',
    'diagnosis',
    4,
    'Diagnostic',
    'diagnostic',
    'Le diagnostic de péricardite aiguë repose sur la douleur thoracique, le frottement péricardique, les modifications ECG et un épanchement péricardique éventuel.',
    'le diagnostic de pericardite aigue repose sur la douleur thoracique le frottement pericardique les modifications ecg et un epanchement pericardique eventuel',
    23,
    'college-cardio-item-231'
  );
```

If triggers were not enabled during bulk loading:

```sql
INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
```

### User question

```text
Quelle est la prise en charge de la complication la plus fréquente de la maladie X ?
```

Parsed frame:

```text
source_entity = maladie x
source_entity_id = 1
source_item_number = 210
bridge_relation = most_frequent_complication
final_intent = management
```

### Hop 1 query

The strict hop-1 `MATCH` expression is:

```text
("maladie x") AND (complication OR complications) AND (frequente OR principal OR principale OR premiere)
```

Concrete SQL:

```sql
SELECT
  c.chunk_id,
  c.item_number,
  c.specialty,
  c.section_path,
  c.section_kind,
  c.chunk_text,
  bm25(chunks_fts, 0.2, 0.5, 1.2, 1.0, 1.0)
    - CASE WHEN c.section_kind = 'complications' THEN 1.5 ELSE 0 END
    - CASE WHEN instr(c.section_path_norm, 'complications') > 0 THEN 0.5 ELSE 0 END
    AS score
FROM chunks_fts
JOIN chunks AS c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH :hop1_match
  AND c.item_number = :source_item_number
  AND c.section_kind IN ('complications', 'prognosis', 'surveillance', 'misc')
ORDER BY score ASC
LIMIT 8;
```

Parameters:

```text
:hop1_match = '("maladie x") AND (complication OR complications) AND (frequente OR principal OR principale OR premiere)'
:source_item_number = 210
```

Expected top result:

```text
chunk_id = 101
section_path = Maladie X > Évolution et complications
chunk_text = La maladie X évolue le plus souvent favorablement. La complication la plus fréquente est la péricardite aiguë, à rechercher devant une douleur thoracique et un frottement péricardique.
```

### Bridge extraction

Normalize the retrieved sentence:

```text
la maladie x evolue le plus souvent favorablement la complication la plus frequente est la pericardite aigue a rechercher devant une douleur thoracique et un frottement pericardique
```

Apply a high-precision relation regex:

```text
/la complication la plus frequente (?:est|reste|demeure) (?<entity>[^,.;:()]+)/
```

Raw extraction:

```text
la pericardite aigue
```

Clean French determiners:

```text
pericardite aigue
```

Resolve against aliases:

```sql
SELECT
  e.entity_id,
  e.canonical_label,
  e.canonical_norm,
  e.entity_type,
  ea.alias_norm
FROM entity_aliases AS ea
JOIN entities AS e ON e.entity_id = ea.entity_id
WHERE ea.alias_norm = :candidate_norm
LIMIT 1;
```

Parameter:

```text
:candidate_norm = 'pericardite aigue'
```

Expected result:

```text
entity_id = 2
canonical_label = Péricardite aiguë
canonical_norm = pericardite aigue
entity_type = complication
```

Cache the relation:

```sql
INSERT INTO relation_cache (
  source_entity_id,
  relation_type,
  target_entity_id,
  target_label,
  target_norm,
  evidence_chunk_id,
  confidence
) VALUES (
  :source_entity_id,
  'most_frequent_complication',
  :target_entity_id,
  :target_label,
  :target_norm,
  :evidence_chunk_id,
  :confidence
)
ON CONFLICT(source_entity_id, relation_type, target_norm)
DO UPDATE SET
  target_entity_id = excluded.target_entity_id,
  target_label = excluded.target_label,
  evidence_chunk_id = excluded.evidence_chunk_id,
  confidence = excluded.confidence,
  updated_at = CURRENT_TIMESTAMP;
```

Parameters:

```text
:source_entity_id = 1
:target_entity_id = 2
:target_label = 'Péricardite aiguë'
:target_norm = 'pericardite aigue'
:evidence_chunk_id = 101
:confidence = 0.92
```

### Hop 2 metadata lookup

Map the bridge entity to its likely EDN item:

```sql
SELECT
  i.item_number,
  i.specialty_norm,
  m.confidence
FROM entity_item_map AS m
JOIN items AS i ON i.item_id = m.item_id
WHERE m.entity_id = :bridge_entity_id
ORDER BY m.confidence DESC
LIMIT 4;
```

Parameter:

```text
:bridge_entity_id = 2
```

Expected result:

```text
item_number = 231
specialty_norm = cardiologie
```

### Hop 2 query

The hop-2 `MATCH` expression is:

```text
("pericardite aigue" OR pericardite) AND ("prise en charge" OR traitement OR therapeutique OR "conduite tenir" OR cat OR surveillance OR hospitalisation)
```

Concrete SQL:

```sql
SELECT
  c.chunk_id,
  c.item_number,
  c.specialty,
  c.section_path,
  c.section_kind,
  c.chunk_text,
  bm25(chunks_fts, 0.2, 0.6, 1.0, 1.4, 1.0)
    - CASE WHEN c.section_kind IN ('management', 'treatment') THEN 1.8 ELSE 0 END
    - CASE WHEN instr(c.section_path_norm, 'prise en charge') > 0 THEN 0.8 ELSE 0 END
    - CASE WHEN c.item_number = :bridge_item_number THEN 0.7 ELSE 0 END
    AS score
FROM chunks_fts
JOIN chunks AS c ON c.chunk_id = chunks_fts.rowid
WHERE chunks_fts MATCH :hop2_match
  AND c.section_kind IN ('management', 'treatment', 'surveillance', 'prevention', 'misc')
ORDER BY score ASC
LIMIT 8;
```

Parameters:

```text
:hop2_match = '("pericardite aigue" OR pericardite) AND ("prise en charge" OR traitement OR therapeutique OR "conduite tenir" OR cat OR surveillance OR hospitalisation)'
:bridge_item_number = 231
```

Expected top result:

```text
chunk_id = 201
section_path = Péricardite aiguë > Prise en charge
chunk_text = La prise en charge de la péricardite aiguë non compliquée associe repos, AINS à dose anti-inflammatoire et colchicine, avec protection gastrique selon le terrain. Une hospitalisation est indiquée en cas de signe de gravité.
```

### Evidence object returned by retrieval

```json
{
  "question": "Quelle est la prise en charge de la complication la plus fréquente de la maladie X ?",
  "hops": [
    {
      "hop": 1,
      "purpose": "resolve_bridge_entity",
      "relation": "most_frequent_complication",
      "source_entity": "Maladie X",
      "selected_bridge_entity": "Péricardite aiguë",
      "evidence_chunk_id": 101,
      "confidence": 0.92
    },
    {
      "hop": 2,
      "purpose": "retrieve_management",
      "target_entity": "Péricardite aiguë",
      "evidence_chunk_id": 201,
      "confidence": 0.88
    }
  ]
}
```

A grounded final answer can then be composed from the two retrieved chunks:

```text
La complication la plus fréquente de la maladie X retrouvée dans le corpus est la péricardite aiguë. Sa prise en charge repose sur le repos, un AINS à dose anti-inflammatoire et la colchicine, avec protection gastrique selon le terrain. Une hospitalisation est indiquée en cas de signe de gravité.
```

## 5. Failure modes and mitigations

### Failure mode 1: wrong bridge entity from a list

A chunk may say:

```text
Les complications sont la péricardite aiguë, la myocardite et les troubles du rythme. La plus grave est la myocardite.
```

A naive extractor may choose the first list item or confuse `plus grave` with `plus fréquente`.

Mitigations:

- Keep relation types separate: `most_frequent_complication` is not `most_severe_complication`.
- Require selector agreement near the candidate.
- Penalize candidates extracted from generic lists unless the selector appears in the same clause.
- If two candidates are close, run hop 2 for both or return ambiguity with evidence.

### Failure mode 2: generic management is not valid in the source-disease context

Hop 2 may retrieve generic management of the complication, but the original disease may change treatment. For example, a complication may require disease-specific immunosuppression, antibiotics, anticoagulation, pregnancy-specific management, or emergency referral.

Mitigations:

- After generic hop 2, run a cheap validation query when needed:

```text
source_entity + bridge_entity + management_terms
```

- Boost source-item chunks that mention both the bridge and management terms.
- Prefer source-specific management over generic management when both are answer-bearing.
- Return both evidence chunks if they complement each other: generic complication management plus disease-specific adjustment.

### Failure mode 3: lexical mismatch and synonym gaps

BM25 can miss the answer if the question says `prise en charge` but the corpus says `conduite à tenir`, `CAT`, `mesures thérapeutiques`, or `traitement`. It can also miss entities with eponyms, abbreviations, spelling variants, plural forms, or accent differences.

Mitigations:

- Normalize accents and punctuation during ingestion.
- Maintain curated French EDN synonym tables for intents and relation words.
- Maintain entity aliases from titles, headings, glossaries, and validated extracted mentions.
- Search section metadata as well as text, so `management` sections are found even when exact words differ.
- Apply staged relaxation: strict query, then remove selector, then relax item filter, then search compatible sections globally.

### Additional practical mitigations

- Use prepared statements for common hop templates.
- Cache normalized question plans by question hash.
- Cache resolved relations in `relation_cache`.
- Keep chunks moderately sized so BM25 does not reward long noisy text.
- Diversify top results by item and section to avoid returning several near-duplicate chunks.
- Log failed or ambiguous retrievals for offline lexicon and template improvement.

The core safety rule is that bridge entities must be supported by retrieved corpus evidence. If hop 1 cannot identify the complication, the system should say that retrieval failed or return an explicit low-confidence result. For EDN preparation, a transparent failure is preferable to an unsupported bridge and a confidently wrong management answer.
