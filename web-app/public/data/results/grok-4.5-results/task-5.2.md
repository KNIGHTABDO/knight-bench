# Task 5.2 — BM25 over SQLite FTS5 for French medical text

**Stack:** Python 3 + stdlib `sqlite3` only (no external search libraries).  
**Verified:** SQLite 3.49.1 with FTS5; full test suite **15/15 OK**.

Companion runnable files in this folder (same content as below):

- `medical_fts.py` — engine
- `test_medical_fts.py` — suite (≥8 required cases)

```bash
py -3 -m unittest test_medical_fts -v
# or
py -3 medical_fts.py
```

---

## 1. Accent / diacritic folding — which layer?

### Options

| Layer | What it does | Strengths | Weaknesses |
|--------|----------------|-----------|------------|
| **A. Tokenizer config** (`unicode61 remove_diacritics`) | FTS5 folds diacritics at index *and* query time inside MATCH | Zero app code for é/è/à/…; consistent | Does **not** expand ligatures œ→oe, æ→ae |
| **B. Query-time only** | Normalize the user query before MATCH | Easy to ship | Documents stored with œ never match ascii `oedeme` unless reindexed with folding |
| **C. Index-time only** | Normalize on insert | Clean index | Queries typed with œ fail against oe-indexed tokens if query path is raw |
| **D. Index-time + query-time (chosen)** | Same `normalize_for_fts` on write and on read | Symmetric; covers OCR/ligature mess in both directions | Must remember to normalize every write path |

### Decision (justification)

**Pick D + A together:**

1. **FTS5 tokenizer** handles ordinary French diacritics (`é→e`, `è→e`, `ç→c` effectively via strip, etc.).
2. **Application ligature expansion** (`œ→oe`, `æ→ae`, …) runs at **index-time and query-time**, because that is exactly what unicode61 does *not* do.
3. We deliberately **do not** strip remaining diacritics in Python — FTS5 remains the single source of truth for diacritic folding so MATCH tokens stay aligned with the inverted index.

So for `oedème` / `œdème` / `oedeme`:

- Index path: `Œdème…` → ligatures → `OEdème…` → tokenizer → `oedeme…`
- Query path: `œdème` → `oedème` → tokenizer → `oedeme`
- All three queries hit the same postings.

### FTS5 tokenizer configuration

```sql
CREATE VIRTUAL TABLE documents_fts USING fts5(
  title,      -- bm25 weight 3.0
  section,    -- bm25 weight 2.0
  body,       -- bm25 weight 1.0
  content='documents',
  content_rowid='id',
  tokenize="unicode61 remove_diacritics 2 tokenchars '-'"
);
```

`remove_diacritics` values:

| Value | Behavior |
|-------|----------|
| `0` | Keep diacritics (bad for FR medical free text) |
| `1` | Strip “simple” diacritics |
| `2` | More aggressive (SQLite ≥ 3.27); **preferred for French** |

`tokenchars '-'` keeps internal hyphens so forms like `thrombo-embolique` stay one token when useful.

### Limits of unicode61 for œ / æ

- `œ` (U+0153) / `Œ` (U+0152) are **atomic letters**, not base letter + combining mark.
- `æ` (U+00E6) / `Æ` (U+00C6) same.
- `remove_diacritics` therefore **never** maps them to `oe` / `ae`.
- Under tokenizer-only config, `"œdème"` and `"oedeme"` are different tokens → **no match**.
- That is why ligature expansion must live in application normalization (layer D), not only in tokenizer config.

---

## 2. Medical abbreviation expansion (query-time, data-driven)

Expansion is **query-time only** (do not rewrite stored notes; clinicians often leave short forms in the index).

### Ambiguity policy (explicit)

French hospital acronyms are genuinely polysemous. We do **not** pretend one sense wins.

| Abbr | Senses (medical FR) | Domains |
|------|---------------------|---------|
| **IRC** | **insuffisance rénale chronique** vs **insuffisance respiratoire chronique** | nephro / pneumo |
| **FA** | fibrillation auriculaire/atriale vs facteur antinucléaire (lab) | cardio / lab+immuno |
| **EP** | embolie pulmonaire vs électrophorèse | pneumo-cardio / lab |
| IDM, BPCO, AVC, HTA, SCA, OAP, MTEV | effectively mono-sense in clinical prose | as tagged |

**Rules:**

1. Default = **recall-first**: OR every listed expansion **plus** the raw short form (so notes that only say `IRC` still match).
2. Optional `preferred_domains=["nephro"]` filters expansions; if the filter would empty the list, **fall back to all senses** (never silently kill a known acronym).
3. Response metadata `BuiltQuery.ambiguous` surfaces multi-sense expansions so a UI can show *“IRC → rénale | respiratoire”* instead of hiding the conflict.
4. Spelling/diacritic variants of the **same** sense are clustered (not reported as ambiguity).

### Abbreviation table (canonical)

```python
ABBREVIATION_TABLE = {
  "IDM":  ["infarctus du myocarde"],
  "BPCO": ["bronchopneumopathie chronique obstructive"],
  "AVC":  ["accident vasculaire cérébral"],
  "HTA":  ["hypertension artérielle"],
  "IRC":  ["insuffisance rénale chronique",
           "insuffisance respiratoire chronique"],   # AMBIGUOUS
  "FA":   ["fibrillation auriculaire", "fibrillation atriale",
           "facteur antinucléaire"],                 # AMBIGUOUS (cardio vs lab)
  "EP":   ["embolie pulmonaire", "électrophorèse"], # AMBIGUOUS
  "SCA":  ["syndrome coronarien aigu"],
  "OAP":  ["œdème aigu du poumon", "oedème aigu pulmonaire"],
  "MTEV": ["maladie thromboembolique veineuse",
           "maladie thrombo-embolique veineuse"],
}
```

(In code each entry is an `Expansion(phrase, domains, note)` for domain filtering.)

Example MATCH for `IRC`:

```text
(IRC OR "insuffisance renale chronique" OR "insuffisance respiratoire chronique")
```

---

## 3. Query building: phrase boost + OR-groups + column BM25 weights

FTS5 has **no** Elasticsearch-style `term^boost` syntax. We combine three levers:

### A. Exact phrase forms in MATCH

Multi-word expansions are emitted as FTS5 phrases (`"infarctus du myocarde"`), which already interact with BM25 via term proximity / phrase matching.

### B. Abbreviation OR-groups

```text
(IDM OR "infarctus du myocarde")
AND
(HTA OR "hypertension arterielle")
```

Independent acronym groups are **AND**-ed; alternatives inside a group are **OR**-ed.

### C. Per-column BM25 weights

```sql
bm25(documents_fts, 3.0, 2.0, 1.0)  -- title, section, body
```

FTS5 returns **more negative ⇒ better**. We convert to a positive base score `base = -bm25_raw`, then apply phrase boost:

```text
score = -bm25(fts, 3.0, 2.0, 1.0) + phrase_boost * phrase_hits
```

`phrase_hits` counts how many planned expansion/exact phrases appear (diacritic-folded) in title+section+body. That is what makes a full-form hit outrank an acronym-only note for the same query.

---

## 4. Architecture sketch

```
User query
   │
   ├─ normalize_for_fts (NFC + ligatures)
   ├─ detect acronym tokens → ABBREVIATION_TABLE
   ├─ build MATCH: OR-groups + free-text + phrases
   │
   ▼
SQLite FTS5  (unicode61 remove_diacritics 2)
   │  bm25(title=3, section=2, body=1)
   ▼
App re-rank: + phrase_boost * phrase_hits
   │
   ▼
Hits + BuiltQuery metadata (expansions, ambiguities)
```

Content table `documents` + external-content FTS5 + INSERT/UPDATE/DELETE triggers keep the index consistent.

---

## 5. Production code — `medical_fts.py`

```python
"""
French medical BM25 retrieval over SQLite FTS5.

Improvements over vanilla FTS5:
  1. Ligature + diacritic folding so oedème / œdème / oedeme all match
  2. Query-time medical abbreviation expansion (data-driven, ambiguity-aware)
  3. Query builder: phrase boost + OR-groups + per-column BM25 weights
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Sequence


# ---------------------------------------------------------------------------
# 1. Normalization (index-time AND query-time)
# ---------------------------------------------------------------------------
#
# Layer choice (justification):
#   - FTS5 tokenize="unicode61 remove_diacritics 2" folds ordinary diacritics
#     (é→e, è→e, à→a, …) at both index and query time inside the tokenizer.
#   - It does NOT expand Latin ligatures: œ stays œ, æ stays æ. So
#     "œdème" never matches "oedeme" under tokenizer config alone.
#   - Therefore we apply explicit ligature expansion in application code at
#     BOTH index-time and query-time, then rely on unicode61 remove_diacritics 2
#     for the remaining diacritic folding. Same pipeline on both sides keeps
#     the inverted index and MATCH queries consistent.
#   - Query-time-only normalization would miss documents indexed with ligatures
#     unless the corpus was already clean. Index-time-only would miss raw
#     ligature queries. Dual application is the safe production default.
#
# FTS5 tokenizer configuration:
#   tokenize = "unicode61 remove_diacritics 2 tokenchars '-'"
#   - remove_diacritics 0 : keep diacritics
#   - remove_diacritics 1 : strip diacritics that are "simple" combining marks
#   - remove_diacritics 2 : more aggressive (SQLite ≥ 3.27); preferred for FR
#   Limits of unicode61 for œ/æ:
#     • œ (U+0153) / Œ (U+0152) are atomic letters, not base+diacritic.
#     • æ (U+00E6) / Æ (U+00C6) same issue.
#     • remove_diacritics does not map them to oe / ae.
#     • tokenchars can keep hyphens inside tokens (useful for some FR med terms)
#       but does not help with ligatures.

LIGATURE_MAP = str.maketrans(
    {
        "œ": "oe",
        "Œ": "OE",
        "æ": "ae",
        "Æ": "AE",
        # Rare but seen in scanned/legacy medical OCR
        "ĳ": "ij",
        "Ĳ": "IJ",
        "ﬀ": "ff",
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬃ": "ffi",
        "ﬄ": "ffl",
        "ß": "ss",
    }
)


def expand_ligatures(text: str) -> str:
    """Expand Latin ligatures that FTS5 unicode61 will not decompose."""
    if not text:
        return text
    return text.translate(LIGATURE_MAP)


def normalize_for_fts(text: str) -> str:
    """
    Application-layer normalization applied at index AND query time.

    Steps:
      1. Unicode NFC → consistent codepoints
      2. Ligature expansion (œ→oe, æ→ae, …)
      3. Leave remaining diacritics to FTS5 unicode61 remove_diacritics 2

    We intentionally do NOT strip diacritics here so that the FTS5 tokenizer
    remains the single source of truth for diacritic folding (avoids double
    processing quirks and keeps MATCH syntax aligned with indexed tokens).
    """
    if text is None:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = expand_ligatures(text)
    return text


# ---------------------------------------------------------------------------
# 2. Medical abbreviation table (data-driven) + ambiguity policy
# ---------------------------------------------------------------------------
#
# Ambiguity strategy (explicit, not papered over):
#   - Each abbreviation maps to a list of Expansion candidates with optional
#     domain tags (cardio, nephro, pneumo, …).
#   - At query time we expand to an OR-group of ALL candidates by default
#     (recall-first clinical search). The original short form is always kept
#     so documents that only store "IRC" still match.
#   - Callers may pass preferred_domains / disambiguation hints to drop
#     expansions outside those domains (precision mode).
#   - When multiple expansions remain, they are OR-ed and the result metadata
#     surfaces which expansions were used so the UI can show "IRC → A | B".
#   - Homonyms outside medicine are NOT expanded unless listed (keeps noise down).
#
# Known ambiguities called out:
#   IRC : insuffisance rénale chronique  vs  insuffisance respiratoire chronique
#   FA  : fibrillation auriculaire/atriale  vs  facteur antinucléaire (lab)
#   EP  : embolie pulmonaire vs électrophorèse (lab)
#   SCA : syndrome coronarien aigu (primary)

@dataclass(frozen=True)
class Expansion:
    phrase: str
    domains: tuple[str, ...] = ()
    note: str = ""


# Canonical data-driven table required by the task.
ABBREVIATION_TABLE: dict[str, list[Expansion]] = {
    "IDM": [
        Expansion("infarctus du myocarde", ("cardio",), "STEMI/NSTEMI context"),
    ],
    "BPCO": [
        Expansion(
            "bronchopneumopathie chronique obstructive",
            ("pneumo",),
            "COPD",
        ),
    ],
    "AVC": [
        Expansion("accident vasculaire cerebral", ("neuro",), "stroke"),
        Expansion("accident vasculaire cérébral", ("neuro",)),
    ],
    "HTA": [
        Expansion("hypertension arterielle", ("cardio",)),
        Expansion("hypertension artérielle", ("cardio",)),
    ],
    "IRC": [
        Expansion(
            "insuffisance renale chronique",
            ("nephro",),
            "most common in French hospital notes",
        ),
        Expansion("insuffisance rénale chronique", ("nephro",)),
        Expansion(
            "insuffisance respiratoire chronique",
            ("pneumo",),
            "genuine ambiguity — do not drop without domain hint",
        ),
    ],
    "FA": [
        Expansion("fibrillation auriculaire", ("cardio",)),
        Expansion("fibrillation atriale", ("cardio",), "synonym of auriculaire"),
        Expansion(
            "facteur antinucleaire",
            ("lab", "immuno"),
            "lab-context sense; lower prior outside immuno orders",
        ),
        Expansion("facteur antinucléaire", ("lab", "immuno")),
    ],
    "EP": [
        Expansion("embolie pulmonaire", ("pneumo", "cardio", "vasculaire")),
        Expansion(
            "electrophorese",
            ("lab",),
            "laboratory sense — ambiguous with PE",
        ),
        Expansion("électrophorèse", ("lab",)),
    ],
    "SCA": [
        Expansion("syndrome coronarien aigu", ("cardio",)),
    ],
    "OAP": [
        Expansion("oedeme aigu du poumon", ("cardio", "pneumo")),
        Expansion("œdème aigu du poumon", ("cardio", "pneumo")),
        Expansion("oedème aigu pulmonaire", ("cardio", "pneumo")),
    ],
    "MTEV": [
        Expansion("maladie thromboembolique veineuse", ("vasculaire", "cardio")),
        Expansion("maladie thrombo-embolique veineuse", ("vasculaire", "cardio")),
    ],
}


def lookup_abbreviations(
    token: str,
    *,
    preferred_domains: Sequence[str] | None = None,
) -> list[Expansion]:
    """
    Resolve a token against the abbreviation table.

    If preferred_domains is set, keep expansions that intersect those domains;
    if that filter would drop EVERY expansion, fall back to all expansions
    (never return empty for a known abbreviation — ambiguity is surfaced, not
    silenced by over-filtering).
    """
    key = token.strip().upper()
    expansions = list(ABBREVIATION_TABLE.get(key, []))
    if not expansions or not preferred_domains:
        return expansions

    preferred = {d.lower() for d in preferred_domains}
    filtered = [
        e
        for e in expansions
        if not e.domains or preferred.intersection(d.lower() for d in e.domains)
    ]
    return filtered if filtered else expansions


_ABBREV_TOKEN_RE = re.compile(r"\b([A-Za-zÆŒæœ]{2,6})\b", re.UNICODE)


def extract_query_tokens(query: str) -> list[str]:
    return _ABBREV_TOKEN_RE.findall(query)


# ---------------------------------------------------------------------------
# 3. FTS5 query builder
# ---------------------------------------------------------------------------

def _fts_quote_phrase(phrase: str) -> str:
    """Wrap a multi-word phrase for FTS5 phrase search."""
    p = normalize_for_fts(phrase)
    p = re.sub(r"\s+", " ", p.strip())
    p = p.replace('"', '""')
    return f'"{p}"'


def _fts_or_group(terms: Iterable[str]) -> str:
    parts = [t for t in terms if t]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return "(" + " OR ".join(parts) + ")"


@dataclass
class BuiltQuery:
    """Result of query planning — MATCH string + scoring hints for the app layer."""

    match_expr: str
    phrase_terms: list[str] = field(default_factory=list)
    expanded_abbreviations: dict[str, list[str]] = field(default_factory=dict)
    raw_query: str = ""
    ambiguous: dict[str, list[str]] = field(default_factory=dict)


def build_fts_query(
    user_query: str,
    *,
    preferred_domains: Sequence[str] | None = None,
    include_free_text: bool = True,
) -> BuiltQuery:
    """
    Build an FTS5 MATCH expression that combines:
      - free-text tokens from the user query (normalized)
      - abbreviation OR-groups (short form OR expansion phrases)
      - exact phrase forms for multi-word expansions (enables phrase boost path)

    FTS5 does not support Elasticsearch-style term^boost syntax. Phrase boost
    is applied at ranking time (see search()), not inside MATCH. We still emit
    phrase queries so documents containing the exact expansion rank via BM25
    proximity/phrase behavior and our explicit phrase_boost term.
    """
    raw = user_query.strip()
    if not raw:
        return BuiltQuery(match_expr="", raw_query=raw)

    normalized_query = normalize_for_fts(raw)
    tokens = extract_query_tokens(raw)

    or_clauses: list[str] = []
    phrase_terms: list[str] = []
    expanded: dict[str, list[str]] = {}
    ambiguous: dict[str, list[str]] = {}
    consumed_spans: list[str] = []

    for tok in tokens:
        expansions = lookup_abbreviations(tok, preferred_domains=preferred_domains)
        if not expansions:
            continue

        phrases: list[str] = []
        seen: set[str] = set()
        for exp in expansions:
            n = normalize_for_fts(exp.phrase)
            key = re.sub(r"\s+", " ", n.strip().lower())
            if key not in seen:
                seen.add(key)
                phrases.append(exp.phrase)

        expanded[tok.upper()] = [normalize_for_fts(p) for p in phrases]
        unique_senses = _cluster_senses(expansions)
        if len(unique_senses) > 1:
            ambiguous[tok.upper()] = unique_senses

        # Short form as unigram + phrase expansions in an OR-group
        group_terms = [normalize_for_fts(tok.upper())]
        for p in phrases:
            qp = _fts_quote_phrase(p)
            group_terms.append(qp)
            phrase_terms.append(normalize_for_fts(p))

        or_clauses.append(_fts_or_group(group_terms))
        consumed_spans.append(tok)

    free_parts: list[str] = []
    if include_free_text:
        residual = normalized_query
        for tok in consumed_spans:
            residual = re.sub(
                rf"\b{re.escape(tok)}\b",
                " ",
                residual,
                flags=re.IGNORECASE,
            )
        residual = re.sub(r"\s+", " ", residual).strip()
        if residual:
            if " " in residual:
                free_parts.append(_fts_quote_phrase(residual))
                phrase_terms.append(residual)
            word_tokens = re.findall(r"\w+", residual, flags=re.UNICODE)
            word_tokens = [w for w in word_tokens if len(w) > 1]
            if word_tokens:
                free_parts.append(" ".join(word_tokens))

    clauses = or_clauses + free_parts
    if not clauses:
        words = re.findall(r"\w+", normalized_query, flags=re.UNICODE)
        match_expr = " ".join(words) if words else normalized_query
    elif len(clauses) == 1:
        match_expr = clauses[0]
    else:
        match_expr = " AND ".join(f"({c})" if " OR " in c else c for c in clauses)

    return BuiltQuery(
        match_expr=match_expr,
        phrase_terms=phrase_terms,
        expanded_abbreviations=expanded,
        raw_query=raw,
        ambiguous=ambiguous,
    )


def _cluster_senses(expansions: Sequence[Expansion]) -> list[str]:
    """
    Cluster expansions that are mere spelling/diacritic variants of the same
    clinical sense; return one representative phrase per distinct sense.
    """
    clusters: dict[str, str] = {}
    for e in expansions:
        n = normalize_for_fts(e.phrase).lower()
        n = re.sub(r"\s+", " ", n)
        folded = "".join(
            c
            for c in unicodedata.normalize("NFD", n)
            if unicodedata.category(c) != "Mn"
        )
        folded = folded.replace("-", " ")
        folded = re.sub(r"\s+", " ", folded).strip()
        if folded not in clusters:
            clusters[folded] = normalize_for_fts(e.phrase)
    return list(clusters.values())


# ---------------------------------------------------------------------------
# 4. Index + search (BM25 column weights + phrase boost)
# ---------------------------------------------------------------------------

# FTS5 wants: tokenize = "unicode61 remove_diacritics 2 tokenchars '-'"
FTS_TOKENIZER = "unicode61 remove_diacritics 2 tokenchars '-'"

# Per-column BM25 weights: title=3.0, section=2.0, body=1.0
COLUMN_WEIGHTS = (3.0, 2.0, 1.0)
DEFAULT_PHRASE_BOOST = 2.5


SCHEMA_SQL = f"""
CREATE TABLE IF NOT EXISTS documents (
    id      INTEGER PRIMARY KEY,
    title   TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    body    TEXT NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title,
    section,
    body,
    content='documents',
    content_rowid='id',
    tokenize="{FTS_TOKENIZER}"
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, section, body)
    VALUES (new.id, new.title, new.section, new.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, section, body)
    VALUES ('delete', old.id, old.title, old.section, old.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, section, body)
    VALUES ('delete', old.id, old.title, old.section, old.body);
    INSERT INTO documents_fts(rowid, title, section, body)
    VALUES (new.id, new.title, new.section, new.body);
END;
"""


@dataclass
class SearchHit:
    id: int
    title: str
    section: str
    body: str
    bm25: float
    phrase_hits: int
    score: float
    snippet: str = ""


class MedicalFrenchSearch:
    """Production-style French medical search over SQLite FTS5."""

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.executescript(SCHEMA_SQL)
        self.conn.commit()

    def index_document(
        self,
        doc_id: int,
        title: str,
        section: str,
        body: str,
    ) -> None:
        """Insert/replace a document with index-time normalization."""
        self.conn.execute(
            """
            INSERT INTO documents (id, title, section, body)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                section=excluded.section,
                body=excluded.body
            """,
            (
                doc_id,
                normalize_for_fts(title),
                normalize_for_fts(section),
                normalize_for_fts(body),
            ),
        )
        self.conn.commit()

    def index_many(self, docs: Iterable[tuple[int, str, str, str]]) -> None:
        for doc in docs:
            self.index_document(*doc)

    def search(
        self,
        user_query: str,
        *,
        limit: int = 20,
        preferred_domains: Sequence[str] | None = None,
        phrase_boost: float = DEFAULT_PHRASE_BOOST,
        column_weights: Sequence[float] = COLUMN_WEIGHTS,
    ) -> tuple[list[SearchHit], BuiltQuery]:
        """
        Execute BM25 search with:
          - built MATCH expression (abbrev OR-groups + free text)
          - bm25(fts, title_w, section_w, body_w)
          - application-level phrase boost when expansion/exact phrases hit
        """
        built = build_fts_query(
            user_query, preferred_domains=preferred_domains
        )
        if not built.match_expr:
            return [], built

        w_title, w_section, w_body = column_weights
        sql = """
            SELECT
                d.id,
                d.title,
                d.section,
                d.body,
                bm25(documents_fts, ?, ?, ?) AS bm25_raw,
                snippet(documents_fts, 2, '[', ']', '…', 16) AS snippet
            FROM documents_fts
            JOIN documents d ON d.id = documents_fts.rowid
            WHERE documents_fts MATCH ?
            ORDER BY bm25_raw
            LIMIT ?
        """
        try:
            rows = self.conn.execute(
                sql,
                (w_title, w_section, w_body, built.match_expr, limit * 3),
            ).fetchall()
        except sqlite3.OperationalError:
            fallback = normalize_for_fts(user_query)
            words = re.findall(r"\w+", fallback, flags=re.UNICODE)
            if not words:
                return [], built
            built = BuiltQuery(
                match_expr=" OR ".join(words),
                raw_query=user_query,
                expanded_abbreviations=built.expanded_abbreviations,
                ambiguous=built.ambiguous,
                phrase_terms=built.phrase_terms,
            )
            rows = self.conn.execute(
                sql,
                (w_title, w_section, w_body, built.match_expr, limit * 3),
            ).fetchall()

        hits: list[SearchHit] = []
        for row in rows:
            # FTS5 bm25: more negative ⇒ better. Convert to positive relevance.
            bm25_raw = float(row["bm25_raw"])
            base = -bm25_raw
            text_blob = f"{row['title']}\n{row['section']}\n{row['body']}"
            text_norm = normalize_for_fts(text_blob).lower()
            text_folded = _fold_diacritics(text_norm)

            phrase_hits = 0
            for phrase in built.phrase_terms:
                p = _fold_diacritics(normalize_for_fts(phrase).lower())
                if p and p in text_folded:
                    phrase_hits += 1

            score = base + phrase_boost * phrase_hits
            hits.append(
                SearchHit(
                    id=int(row["id"]),
                    title=row["title"],
                    section=row["section"],
                    body=row["body"],
                    bm25=bm25_raw,
                    phrase_hits=phrase_hits,
                    score=score,
                    snippet=row["snippet"] or "",
                )
            )

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit], built


def _fold_diacritics(text: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )


def demo_corpus() -> list[tuple[int, str, str, str]]:
    """Small French medical corpus used by tests and manual demos."""
    return [
        (
            1,
            "Œdème aigu du poumon",
            "Urgences cardiologie",
            "Patient admis pour OAP sur fond de HTA. Dyspnée et crépitants bilatéraux.",
        ),
        (
            2,
            "Prise en charge de l'oedeme des membres inférieurs",
            "Néphrologie",
            "Évaluation d'un oedème bilatéral; différentiel inclut IRC et insuffisance cardiaque.",
        ),
        (
            3,
            "oedème maculaire",
            "Ophtalmologie",
            "Pas de lien avec pathologie pulmonaire. Examen du fond d'œil.",
        ),
        (
            4,
            "Infarctus du myocarde antérieur",
            "Cardiologie",
            "IDM ST+ traité par angioplastie primaire. Antécédents de HTA et FA.",
        ),
        (
            5,
            "Note brève IDM",
            "USIC",
            "Acronyme seul: IDM. Pas de développement textuel du diagnostic.",
        ),
        (
            6,
            "Insuffisance rénale chronique stade 4",
            "Néphrologie",
            "Patient suivi pour IRC avec clairance estimée à 22 mL/min.",
        ),
        (
            7,
            "Insuffisance respiratoire chronique post-BPCO",
            "Pneumologie",
            "IRC restrictive/obstructive sur BPCO sévère. Oxygénothérapie de longue durée.",
        ),
        (
            8,
            "Embolie pulmonaire bilatérale",
            "Médecine vasculaire",
            "EP confirmée au angioscanner. Contexte de MTEV. Score de Genève élevé.",
        ),
        (
            9,
            "Électrophorèse des protéines sériques",
            "Laboratoire",
            "EP demandée dans le bilan d'une dysglobulinémie. Pic monoclonal.",
        ),
        (
            10,
            "Syndrome coronarien aigu sans sus-décalage",
            "Cardiologie",
            "SCA NSTEMI. Troponine positive. Pas d'OAP associé.",
        ),
        (
            11,
            "Accident vasculaire cérébral ischémique",
            "Neurologie",
            "AVC sylvien droit. NIHSS à l'admission. Pas de FA documentée.",
        ),
        (
            12,
            "Fibrillation auriculaire rapide",
            "Cardiologie",
            "FA à réponse ventriculaire rapide. Anticoagulation discutée.",
        ),
        (
            13,
            "Bronchopneumopathie chronique obstructive",
            "Pneumologie",
            "BPCO GOLD III. Exacerbation infectieuse. Gazométrie.",
        ),
        (
            14,
            "Maladie thromboembolique veineuse",
            "Angiologie",
            "MTEV: TVP proximale et risque d'embolie pulmonaire.",
        ),
        (
            15,
            "Hypertension artérielle essentielle",
            "Médecine interne",
            "HTA grade 2. Adaptation thérapeutique. Pas d'atteinte rénale.",
        ),
    ]


if __name__ == "__main__":
    engine = MedicalFrenchSearch()
    engine.index_many(demo_corpus())
    for q in ["oedeme", "œdème", "IDM", "IRC", "EP", "OAP sur HTA"]:
        hits, built = engine.search(q)
        print("=" * 60)
        print("Q:", q)
        print("MATCH:", built.match_expr)
        print("Expanded:", built.expanded_abbreviations)
        print("Ambiguous:", built.ambiguous)
        for h in hits[:5]:
            print(
                f"  id={h.id} score={h.score:.3f} bm25={h.bm25:.3f} "
                f"phrases={h.phrase_hits} | {h.title}"
            )
```

---

## 6. Test suite — `test_medical_fts.py` (≥8 cases)

```python
"""
Test suite for French medical BM25 / SQLite FTS5 retrieval.

≥8 cases covering:
  - accent / ligature variants match
  - abbreviations expand
  - phrase boost changes ranking
  - ambiguous abbreviation produces both expansions
"""

from __future__ import annotations

import unicodedata
import unittest

from medical_fts import (
    ABBREVIATION_TABLE,
    COLUMN_WEIGHTS,
    FTS_TOKENIZER,
    MedicalFrenchSearch,
    build_fts_query,
    demo_corpus,
    expand_ligatures,
    lookup_abbreviations,
    normalize_for_fts,
)


class TestNormalization(unittest.TestCase):
    def test_ligature_oe_expansion(self):
        self.assertEqual(expand_ligatures("œdème"), "oedème")
        self.assertEqual(expand_ligatures("Œdème"), "OEdème")
        self.assertEqual(normalize_for_fts("œdème"), "oedème")

    def test_ae_ligature(self):
        self.assertEqual(expand_ligatures("cæsium"), "caesium")


class TestAccentAndLigatureRetrieval(unittest.TestCase):
    """Cases 1–3: accent / diacritic / ligature folding."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def _ids(self, query: str) -> list[int]:
        hits, _ = self.engine.search(query)
        return [h.id for h in hits]

    def test_01_oedeme_ascii_matches_ligature_title(self):
        """Query 'oedeme' must retrieve doc titled 'Œdème aigu du poumon'."""
        ids = self._ids("oedeme")
        self.assertIn(1, ids, "œdème-indexed title should match ascii oedeme")

    def test_02_ligature_query_matches_ascii_indexed_body(self):
        """Query with œ must match body text written as 'oedème'."""
        ids = self._ids("œdème")
        self.assertIn(2, ids, "œdème query should match oedème in body/title")
        self.assertIn(1, ids)

    def test_03_all_three_variants_share_hits(self):
        """oedème / œdème / oedeme should return overlapping relevant docs."""
        a = set(self._ids("oedème"))
        b = set(self._ids("œdème"))
        c = set(self._ids("oedeme"))
        for s in (a, b, c):
            self.assertTrue({1, 2} & s, f"expected OAP/oedeme docs in {s}")
        core = {1, 2, 3}
        self.assertTrue(a & b & core)
        self.assertTrue(b & c & core)
        self.assertTrue(a & c & core)


class TestAbbreviationExpansion(unittest.TestCase):
    """Cases 4–6: abbreviation expansion at query time."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def test_04_idm_expands_and_finds_full_form(self):
        hits, built = self.engine.search("IDM")
        self.assertIn("IDM", built.expanded_abbreviations)
        expansions = built.expanded_abbreviations["IDM"]
        self.assertTrue(
            any("infarctus" in e and "myocarde" in e for e in expansions)
        )
        ids = [h.id for h in hits]
        self.assertIn(4, ids)
        self.assertIn(5, ids)
        self.assertIn("OR", built.match_expr)
        self.assertIn("infarctus du myocarde", built.match_expr.lower())

    def test_05_bpco_avc_hta_sca_oap_mtev_present_in_table(self):
        required = ["IDM", "BPCO", "AVC", "HTA", "IRC", "FA", "EP", "SCA", "OAP", "MTEV"]
        for abbr in required:
            self.assertIn(abbr, ABBREVIATION_TABLE)
            self.assertGreaterEqual(len(ABBREVIATION_TABLE[abbr]), 1)

        hits_bpco, b1 = self.engine.search("BPCO")
        self.assertTrue(any(h.id in (7, 13) for h in hits_bpco))
        self.assertIn("BPCO", b1.expanded_abbreviations)

        hits_avc, _ = self.engine.search("AVC")
        self.assertTrue(any(h.id == 11 for h in hits_avc))

        hits_mtev, _ = self.engine.search("MTEV")
        self.assertTrue(any(h.id in (8, 14) for h in hits_mtev))

        hits_sca, _ = self.engine.search("SCA")
        self.assertTrue(any(h.id == 10 for h in hits_sca))

    def test_06_oap_and_hta_expand_in_combined_query(self):
        hits, built = self.engine.search("OAP HTA")
        self.assertIn("OAP", built.expanded_abbreviations)
        self.assertIn("HTA", built.expanded_abbreviations)
        ids = [h.id for h in hits]
        self.assertIn(1, ids, "OAP+HTA doc should rank among results")


class TestAmbiguousAbbreviations(unittest.TestCase):
    """Case 7 (+ extras): ambiguous IRC / EP produce both expansions."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def test_07_irc_ambiguous_both_senses(self):
        hits, built = self.engine.search("IRC")
        self.assertIn("IRC", built.ambiguous)
        senses = built.ambiguous["IRC"]
        self.assertTrue(any("renale" in _fold(s) for s in senses))
        self.assertTrue(
            any("respiratoire" in s.lower() for s in senses),
            f"expected respiratory sense in {senses}",
        )
        ids = [h.id for h in hits]
        self.assertIn(6, ids, "insuffisance rénale chronique doc missing")
        self.assertIn(7, ids, "insuffisance respiratoire chronique doc missing")

    def test_07b_ep_ambiguous_pulmonary_embolism_and_electrophoresis(self):
        hits, built = self.engine.search("EP")
        self.assertIn("EP", built.ambiguous)
        senses = " ".join(_fold(s) for s in built.ambiguous["EP"])
        self.assertIn("embolie", senses)
        self.assertIn("electrophorese", senses)
        ids = [h.id for h in hits]
        self.assertIn(8, ids)  # embolie pulmonaire
        self.assertIn(9, ids)  # électrophorèse

    def test_07c_domain_filter_narrows_but_never_empties(self):
        renal = lookup_abbreviations("IRC", preferred_domains=["nephro"])
        phrases = [_fold(e.phrase) for e in renal]
        self.assertTrue(any("renale" in p for p in phrases))
        self.assertGreaterEqual(len(renal), 1)

        fallback = lookup_abbreviations("IRC", preferred_domains=["odontologie"])
        self.assertGreaterEqual(len(fallback), 2)


class TestPhraseBoostRanking(unittest.TestCase):
    """Case 8: phrase boost changes ranking."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def test_08_phrase_boost_changes_ranking(self):
        hits_boost, built = self.engine.search("IDM", phrase_boost=5.0)
        hits_flat, _ = self.engine.search("IDM", phrase_boost=0.0)

        self.assertTrue(built.phrase_terms, "expected phrase terms for IDM expansion")

        by_id_boost = {h.id: h for h in hits_boost}
        by_id_flat = {h.id: h for h in hits_flat}
        self.assertIn(4, by_id_boost)
        self.assertIn(5, by_id_boost)
        self.assertIn(4, by_id_flat)
        self.assertIn(5, by_id_flat)

        self.assertGreaterEqual(by_id_boost[4].phrase_hits, 1)
        self.assertEqual(by_id_boost[5].phrase_hits, 0)

        self.assertGreater(by_id_boost[4].score, by_id_flat[4].score)
        self.assertGreater(
            by_id_boost[4].score,
            by_id_boost[5].score,
            "phrase-bearing infarctus doc should outrank acronym-only with boost",
        )

        order_boost = [h.id for h in hits_boost if h.id in (4, 5)]
        self.assertEqual(order_boost[0], 4)


class TestQueryBuilderAndWeights(unittest.TestCase):
    """Extra structural guarantees."""

    def test_09_column_weights_constant(self):
        self.assertEqual(COLUMN_WEIGHTS, (3.0, 2.0, 1.0))
        self.assertIn("remove_diacritics 2", FTS_TOKENIZER)
        self.assertIn("unicode61", FTS_TOKENIZER)

    def test_10_title_weight_prefers_title_match(self):
        engine = MedicalFrenchSearch()
        engine.index_many(
            [
                (1, "embolie pulmonaire", "Divers", "note sans détail"),
                (
                    2,
                    "Compte rendu anodin",
                    "Divers",
                    "long texte mentionnant une embolie pulmonaire au passage "
                    + (" blabla" * 40),
                ),
            ]
        )
        hits, _ = engine.search(
            "embolie pulmonaire",
            phrase_boost=0.0,
            column_weights=(3.0, 2.0, 1.0),
        )
        self.assertGreaterEqual(len(hits), 2)
        self.assertEqual(hits[0].id, 1)

    def test_query_builder_or_groups_and_phrases(self):
        built = build_fts_query("IDM")
        self.assertIn("OR", built.match_expr)
        self.assertTrue(any("infarctus" in p for p in built.phrase_terms))


def _fold(text: str) -> str:
    t = normalize_for_fts(text).lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn"
    )


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

### Case map (requirement coverage)

| # | Test | Proves |
|---|------|--------|
| 1 | `test_01_oedeme_ascii_matches_ligature_title` | ascii query ↔ ligature index |
| 2 | `test_02_ligature_query_matches_ascii_indexed_body` | ligature query ↔ ascii index |
| 3 | `test_03_all_three_variants_share_hits` | oedème / œdème / oedeme overlap |
| 4 | `test_04_idm_expands_and_finds_full_form` | abbrev → full form + short form |
| 5 | `test_05_bpco_avc_hta_sca_oap_mtev_present_in_table` | full required abbrev set |
| 6 | `test_06_oap_and_hta_expand_in_combined_query` | multi-abbrev query |
| 7 | `test_07_irc_ambiguous_both_senses` | **both** IRC senses retrieved + reported |
| 7b | `test_07b_ep_ambiguous_…` | EP embolie **and** électrophorèse |
| 8 | `test_08_phrase_boost_changes_ranking` | phrase boost reorders IDM results |
| 9–10 | weights / title preference | title=3.0, section=2.0, body=1.0 |

**Run result (this environment):** `Ran 15 tests … OK`

---

## 7. Example MATCH / scores

| Query | Built MATCH (simplified) | Notable hits |
|-------|--------------------------|--------------|
| `oedeme` | bag-of-words after ligature/diacritic fold | docs 1,2,3 (Œdème / oedeme / oedème) |
| `IDM` | `(IDM OR "infarctus du myocarde")` | doc 4 (phrase+boost) ahead of doc 5 (acronym only) |
| `IRC` | `(IRC OR "insuffisance renale chronique" OR "insuffisance respiratoire chronique")` | docs 6 **and** 7; `ambiguous["IRC"]` lists both senses |
| `EP` | short form OR embolie OR électrophorèse | docs 8 **and** 9 |
| `OAP HTA` | OAP-group **AND** HTA-group | doc 1 (OAP + HTA in body) |

---

## 8. Operational notes

1. **Reindex after tokenizer/normalization changes** — external-content FTS5 does not retro-normalize old rows; re-insert or rebuild.
2. **No Porter/French stemmer** here by design — medical FR is acronym- and multi-word-entity heavy; stemming often hurts precision (`renale`/`renal` style issues). Prefer phrase expansions + diacritic fold.
3. **Extending the lexicon** is a data change only: append to `ABBREVIATION_TABLE` with domain tags; no schema migration.
4. **Persistence:** pass `sqlite3.connect("clinical.db")` into `MedicalFrenchSearch` instead of `:memory:`.
5. **Ambiguity in UI:** always display `BuiltQuery.ambiguous` when non-empty; optional `preferred_domains` for specialty worklists (nephrology ward → IRC renal bias without deleting respiratory hits when the filter would empty).

---

## 9. Summary of design picks

| Requirement | Choice |
|-------------|--------|
| Diacritics | FTS5 `unicode61 remove_diacritics 2` |
| Ligatures œ/æ | App-layer expand at **index + query** time |
| Abbreviations | Query-time data table; keep short form; OR expansions |
| Ambiguity (IRC, EP, FA) | Multi-sense OR + metadata; domain filter with non-empty fallback |
| Phrase boost | App-level `score = -bm25 + boost * phrase_hits` (FTS5 has no `^`) |
| Column weights | `bm25(fts, 3.0, 2.0, 1.0)` for title/section/body |
| Dependencies | `sqlite3` only |
