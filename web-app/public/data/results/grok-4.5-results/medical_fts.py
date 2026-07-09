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
from typing import Any, Iterable, Sequence


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
#   FA  : fibrillation auriculaire/atriale  vs  (less common) facteur antinucléaire
#         in some lab contexts — we list both with domain tags
#   EP  : embolie pulmonaire (primary) vs état de mal épileptique is usually
#         "EME"/"EME" not EP; EP can also mean "électrophorèse" in labs —
#         listed with domains
#   SCA : syndrome coronarien aigu (primary); rare other uses omitted

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
        # normalized form without diacritics for the expansion phrase itself;
        # normalize_for_fts still runs on it so "cérébral" form is fine too
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


# Tokens that look like abbreviations we might expand: 2–6 uppercase letters
# after normalization we still detect on the original query tokens.
_ABBREV_TOKEN_RE = re.compile(r"\b([A-Za-zÆŒæœ]{2,6})\b", re.UNICODE)


def extract_query_tokens(query: str) -> list[str]:
    return _ABBREV_TOKEN_RE.findall(query)


# ---------------------------------------------------------------------------
# 3. FTS5 query builder
# ---------------------------------------------------------------------------

def _fts_quote_phrase(phrase: str) -> str:
    """
    Wrap a multi-word phrase for FTS5 phrase search.
    Escape embedded double quotes; fold ligatures; collapse whitespace.
    """
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

        # Deduplicate phrases after normalization
        phrases: list[str] = []
        seen: set[str] = set()
        for exp in expansions:
            n = normalize_for_fts(exp.phrase)
            key = re.sub(r"\s+", " ", n.strip().lower())
            if key not in seen:
                seen.add(key)
                phrases.append(exp.phrase)

        expanded[tok.upper()] = [normalize_for_fts(p) for p in phrases]
        # Distinct clinical senses (not mere diacritic variants) → ambiguous
        sense_keys = {
            re.sub(r"\s+", " ", normalize_for_fts(e.phrase).lower())
            # collapse diacritics for sense comparison
            for e in expansions
        }
        # Use domain-aware sense clustering: group by primary non-diacritic stem set
        unique_senses = _cluster_senses(expansions)
        if len(unique_senses) > 1:
            ambiguous[tok.upper()] = unique_senses

        group_terms = [_fts_quote_phrase(tok.upper())]  # keep short form as token
        # Single-token short form without quotes is better for FTS5 unigrams
        group_terms = [normalize_for_fts(tok.upper())]
        for p in phrases:
            qp = _fts_quote_phrase(p)
            group_terms.append(qp)
            phrase_terms.append(normalize_for_fts(p))

        or_clauses.append(_fts_or_group(group_terms))
        consumed_spans.append(tok)

    free_parts: list[str] = []
    if include_free_text:
        # Remaining free text: normalize, strip consumed abbreviation tokens,
        # emit as AND of tokens plus a full-query phrase for boost eligibility.
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
            # Full residual as phrase candidate
            if " " in residual:
                free_parts.append(_fts_quote_phrase(residual))
                phrase_terms.append(residual)
            # AND of individual tokens for recall
            word_tokens = re.findall(r"[A-Za-z0-9]+", residual, flags=re.UNICODE)
            # Also keep accented letters via a broader class on original residual
            word_tokens = re.findall(r"\w+", residual, flags=re.UNICODE)
            word_tokens = [w for w in word_tokens if len(w) > 1]
            if word_tokens:
                free_parts.append(" ".join(word_tokens))

    clauses = or_clauses + free_parts
    if not clauses:
        # Fallback: whole normalized query as bag of words
        words = re.findall(r"\w+", normalized_query, flags=re.UNICODE)
        match_expr = " ".join(words) if words else normalized_query
    elif len(clauses) == 1:
        match_expr = clauses[0]
    else:
        # AND independent groups (abbrev expansion groups + free text)
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
        # Rough diacritic strip for clustering only
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
# SQLite bm25(fts, w1, w2, w3) assigns weights to columns in table order.
# Lower (more negative) bm25 score = better match; we convert to a positive
# relevance score for easier phrase-boost arithmetic.
COLUMN_WEIGHTS = (3.0, 2.0, 1.0)
DEFAULT_PHRASE_BOOST = 2.5  # added to positive relevance when phrase hits


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
    VALUES (
        new.id,
        new.title,
        new.section,
        new.body
    );
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
            # Fallback: simpler bag-of-words MATCH if expression is too exotic
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
            # Also fold diacritics for phrase detection parity with FTS5
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
