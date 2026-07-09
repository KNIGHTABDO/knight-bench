# SQLite FTS5 BM25 Retrieval for Medical French

This answer provides a production-quality Python implementation using only the Python standard library `sqlite3` module. It builds a SQLite FTS5 index for French medical text, improves matching for accent and ligature variants, expands medical abbreviations at query time, combines exact phrase boosts with expanded OR groups, and ranks with per-column BM25 weights: `title=3.0`, `section=2.0`, `body=1.0`.

The implementation is intentionally self-contained: save the code blocks as the indicated files and run `python -m unittest -v`.

## Design choices

### 1. Accent and diacritic folding

SQLite FTS5 should handle ordinary French diacritics at the tokenizer layer. The recommended FTS5 tokenizer configuration is:

```sql
CREATE VIRTUAL TABLE documents_fts USING fts5(
  title,
  section,
  body,
  content='documents',
  content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Why tokenizer-layer folding is the right default:

- It keeps the stored canonical text untouched in the content table.
- It normalizes terms consistently for indexing and querying through FTS5.
- It avoids query-only hacks where the query is folded but indexed tokens are not.
- It lets SQLite's FTS engine keep using its token index efficiently.

Important limit: `unicode61 remove_diacritics 2` removes combining diacritics such as `é -> e`, but it does not reliably expand compatibility ligatures such as `œ -> oe` or `æ -> ae`. For medical French this matters: `œdème`, `oedème`, and `oedeme` should all match.

To cover both accents and ligatures correctly, this implementation uses a small normalized shadow-text layer for the FTS columns:

- The canonical table stores the original text.
- The FTS table indexes normalized `title_fts`, `section_fts`, and `body_fts` values.
- Query terms and phrases are normalized with the same function before building the FTS query.
- The tokenizer still uses `unicode61 remove_diacritics 2` as a second line of defense.

This is index-time normalization plus matching query-time normalization. It is preferable here because SQLite's tokenizer alone does not expand `œ`/`æ`, while query-time-only normalization would not fix already-indexed ligature tokens.

### 2. Medical abbreviation expansion at query time

Abbreviations are expanded at query time, not index time. This preserves original documents, avoids bloating the index with synonym duplicates, and makes abbreviation policy data-driven and auditable. The expansion table can evolve without rebuilding the corpus.

The table below deliberately models ambiguity rather than pretending each abbreviation has one meaning. For example, `IRC` can mean `insuffisance rénale chronique`, but in context can also mean `insuffisance respiratoire chronique`. The query builder emits an OR group containing the literal abbreviation and all configured expansions.

| Abbreviation | Expansions |
|---|---|
| IDM | infarctus du myocarde |
| BPCO | bronchopneumopathie chronique obstructive; broncho pneumopathie chronique obstructive |
| AVC | accident vasculaire cérébral |
| HTA | hypertension artérielle |
| IRC | insuffisance rénale chronique; insuffisance respiratoire chronique |
| FA | fibrillation auriculaire; fibrillation atriale |
| EP | embolie pulmonaire; épanchement pleural |
| SCA | syndrome coronarien aigu |
| OAP | oedème aigu du poumon; œdème aigu du poumon |
| MTEV | maladie thromboembolique veineuse; maladie thrombo-embolique veineuse |

Ambiguity strategy:

- All expansions for an ambiguous abbreviation are searched.
- The literal abbreviation is kept in the OR group.
- Exact user phrases are boosted separately, so a document matching the exact entered phrase can outrank a broader expansion-only hit.
- Domain teams can add contextual filters later, but the retriever itself remains recall-oriented and explicit.

### 3. Ranking strategy

The search query combines three ingredients:

1. A normalized exact phrase candidate built from the full user query, used as a rank boost.
2. Expanded abbreviation OR groups, for example `IRC` becomes `(irc OR "insuffisance renale chronique" OR "insuffisance respiratoire chronique")`.
3. SQLite FTS5 BM25 with per-column weights:

```sql
bm25(documents_fts, 3.0, 2.0, 1.0)
```

FTS5 returns lower BM25 values for better matches, so the final score is:

```text
score = -bm25 + exact_phrase_boost
```

The exact phrase boost is computed with an auxiliary FTS5 phrase query against the same row. It is intentionally separate from the broad recall query, so a phrase match changes ranking without excluding abbreviation-expanded matches.

## Implementation

### `medical_fts.py`

```python
from __future__ import annotations

import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Sequence


ABBREVIATION_EXPANSIONS: dict[str, tuple[str, ...]] = {
    "IDM": ("infarctus du myocarde",),
    "BPCO": (
        "bronchopneumopathie chronique obstructive",
        "broncho pneumopathie chronique obstructive",
    ),
    "AVC": ("accident vasculaire cérébral",),
    "HTA": ("hypertension artérielle",),
    "IRC": (
        "insuffisance rénale chronique",
        "insuffisance respiratoire chronique",
    ),
    "FA": (
        "fibrillation auriculaire",
        "fibrillation atriale",
    ),
    "EP": (
        "embolie pulmonaire",
        "épanchement pleural",
    ),
    "SCA": ("syndrome coronarien aigu",),
    "OAP": (
        "oedème aigu du poumon",
        "œdème aigu du poumon",
    ),
    "MTEV": (
        "maladie thromboembolique veineuse",
        "maladie thrombo-embolique veineuse",
    ),
}

TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)
FTS_SPECIAL_CHARS_RE = re.compile(r'(["\\])')


@dataclass(frozen=True)
class Document:
    id: int
    title: str
    section: str
    body: str


@dataclass(frozen=True)
class SearchResult:
    id: int
    title: str
    section: str
    body: str
    bm25: float
    exact_phrase_match: bool
    score: float


@dataclass(frozen=True)
class BuiltQuery:
    match_query: str
    exact_phrase_query: str | None
    normalized_query: str


def normalize_medical_french(text: str) -> str:
    """Normalize French medical text for FTS matching.

    SQLite unicode61 handles many diacritics, but not all useful compatibility
    forms. We expand ligatures explicitly, then strip combining marks.
    """

    ligature_folded = (
        text.replace("œ", "oe")
        .replace("Œ", "oe")
        .replace("æ", "ae")
        .replace("Æ", "ae")
    )
    decomposed = unicodedata.normalize("NFKD", ligature_folded)
    without_marks = "".join(
        char for char in decomposed if unicodedata.category(char) != "Mn"
    )
    return without_marks.casefold()


def tokenize_query(text: str) -> list[str]:
    return TOKEN_RE.findall(normalize_medical_french(text))


def quote_fts_phrase(text: str) -> str:
    normalized = normalize_medical_french(text)
    phrase = " ".join(TOKEN_RE.findall(normalized))
    escaped = FTS_SPECIAL_CHARS_RE.sub(r"\\\1", phrase)
    return f'"{escaped}"'


def quote_fts_token(token: str) -> str:
    normalized_tokens = TOKEN_RE.findall(normalize_medical_french(token))
    if not normalized_tokens:
        raise ValueError(f"Cannot build an FTS token from {token!r}")
    escaped = FTS_SPECIAL_CHARS_RE.sub(r"\\\1", normalized_tokens[0])
    return f'"{escaped}"'


def build_query(user_query: str) -> BuiltQuery:
    """Build an FTS5 MATCH expression with abbreviation expansion.

    Each abbreviation token becomes an OR group containing the literal token and
    all configured expansions as quoted phrases. Non-abbreviation terms are kept
    as required terms by joining groups with AND.
    """

    tokens = tokenize_query(user_query)
    if not tokens:
        raise ValueError("Search query must contain at least one searchable token")

    groups: list[str] = []
    for token in tokens:
        upper_token = token.upper()
        expansions = ABBREVIATION_EXPANSIONS.get(upper_token)
        if expansions:
            alternatives = [quote_fts_token(token)]
            alternatives.extend(quote_fts_phrase(expansion) for expansion in expansions)
            groups.append("(" + " OR ".join(alternatives) + ")")
        else:
            groups.append(quote_fts_token(token))

    normalized_query = " ".join(tokens)
    exact_phrase_query = quote_fts_phrase(user_query) if len(tokens) > 1 else None
    return BuiltQuery(
        match_query=" AND ".join(groups),
        exact_phrase_query=exact_phrase_query,
        normalized_query=normalized_query,
    )


class MedicalFtsSearch:
    """SQLite FTS5 search for French medical text."""

    def __init__(self, connection: sqlite3.Connection | None = None) -> None:
        self.connection = connection or sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self._create_schema()

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                section TEXT NOT NULL,
                body TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                title,
                section,
                body,
                content='documents',
                content_rowid='id',
                tokenize = 'unicode61 remove_diacritics 2'
            );
            """
        )

    def add_documents(self, documents: Iterable[Document]) -> None:
        rows = list(documents)
        with self.connection:
            self.connection.executemany(
                """
                INSERT INTO documents(id, title, section, body)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    section = excluded.section,
                    body = excluded.body
                """,
                [(doc.id, doc.title, doc.section, doc.body) for doc in rows],
            )
            self.connection.executemany(
                "DELETE FROM documents_fts WHERE rowid = ?",
                [(doc.id,) for doc in rows],
            )
            self.connection.executemany(
                """
                INSERT INTO documents_fts(rowid, title, section, body)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        doc.id,
                        normalize_medical_french(doc.title),
                        normalize_medical_french(doc.section),
                        normalize_medical_french(doc.body),
                    )
                    for doc in rows
                ],
            )

    def search(
        self,
        user_query: str,
        *,
        limit: int = 10,
        exact_phrase_boost: float = 3.0,
    ) -> list[SearchResult]:
        built = build_query(user_query)
        exact_phrase_sql = self._exact_phrase_sql(built.exact_phrase_query)
        sql = f"""
            SELECT
                d.id,
                d.title,
                d.section,
                d.body,
                bm25(documents_fts, 3.0, 2.0, 1.0) AS bm25_score,
                {exact_phrase_sql} AS exact_phrase_match
            FROM documents_fts
            JOIN documents AS d ON d.id = documents_fts.rowid
            WHERE documents_fts MATCH ?
            ORDER BY (-bm25_score + (? * exact_phrase_match)) DESC, d.id ASC
            LIMIT ?
        """
        rows = self.connection.execute(
            sql,
            (built.match_query, exact_phrase_boost, limit),
        ).fetchall()
        return [
            SearchResult(
                id=row["id"],
                title=row["title"],
                section=row["section"],
                body=row["body"],
                bm25=float(row["bm25_score"]),
                exact_phrase_match=bool(row["exact_phrase_match"]),
                score=-float(row["bm25_score"])
                + exact_phrase_boost * int(row["exact_phrase_match"]),
            )
            for row in rows
        ]

    def _exact_phrase_sql(self, exact_phrase_query: str | None) -> str:
        if exact_phrase_query is None:
            return "0"
        escaped_query = exact_phrase_query.replace("'", "''")
        return (
            "EXISTS ("
            "SELECT 1 FROM documents_fts AS phrase_fts "
            "WHERE phrase_fts.rowid = documents_fts.rowid "
            f"AND phrase_fts MATCH '{escaped_query}'"
            ")"
        )


if __name__ == "__main__":
    engine = MedicalFtsSearch()
    engine.add_documents(
        [
            Document(
                1,
                "Oedème aigu du poumon",
                "Urgences cardiologiques",
                "Dyspnée brutale avec crépitants diffus.",
            ),
            Document(
                2,
                "Infarctus du myocarde",
                "Cardiologie",
                "Douleur thoracique avec sus-décalage du segment ST.",
            ),
        ]
    )
    for result in engine.search("œdème aigu"):
        print(result)
```

## Tests

### `test_medical_fts.py`

```python
from __future__ import annotations

import unittest

from medical_fts import (
    ABBREVIATION_EXPANSIONS,
    Document,
    MedicalFtsSearch,
    build_query,
    normalize_medical_french,
)


class MedicalFtsSearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = MedicalFtsSearch()
        self.engine.add_documents(
            [
                Document(
                    1,
                    "Œdème aigu du poumon",
                    "Urgences",
                    "Patient avec dyspnée brutale et crépitants.",
                ),
                Document(
                    2,
                    "Oedeme périphérique",
                    "Médecine interne",
                    "Gonflement chronique des membres inférieurs.",
                ),
                Document(
                    3,
                    "Infarctus du myocarde",
                    "Cardiologie",
                    "Douleur thoracique prolongée compatible avec IDM.",
                ),
                Document(
                    4,
                    "Bronchopneumopathie chronique obstructive",
                    "Pneumologie",
                    "Exacerbation de BPCO avec sibilants.",
                ),
                Document(
                    5,
                    "Accident vasculaire cérébral",
                    "Neurologie",
                    "Déficit neurologique focal brutal.",
                ),
                Document(
                    6,
                    "Insuffisance rénale chronique",
                    "Néphrologie",
                    "IRC stade 4 avec clairance basse.",
                ),
                Document(
                    7,
                    "Insuffisance respiratoire chronique",
                    "Pneumologie",
                    "IRC sur BPCO évoluée avec hypoxémie.",
                ),
                Document(
                    8,
                    "Hypertension artérielle",
                    "Cardiologie",
                    "HTA essentielle traitée par IEC.",
                ),
                Document(
                    9,
                    "Fibrillation atriale",
                    "Rythmologie",
                    "FA rapide sous anticoagulation.",
                ),
                Document(
                    10,
                    "Embolie pulmonaire",
                    "Urgences",
                    "EP probable avec douleur thoracique et dyspnée.",
                ),
                Document(
                    11,
                    "Épanchement pleural",
                    "Pneumologie",
                    "EP liquidien gauche à ponctionner.",
                ),
                Document(
                    12,
                    "Syndrome coronarien aigu",
                    "Cardiologie",
                    "SCA sans sus-décalage du segment ST.",
                ),
                Document(
                    13,
                    "Maladie thromboembolique veineuse",
                    "Vasculaire",
                    "MTEV avec thrombose veineuse profonde.",
                ),
                Document(
                    14,
                    "Cas général de douleur thoracique",
                    "Urgences",
                    "Le dossier mentionne douleur thoracique, douleur thoracique, douleur thoracique, mais pas infarctus du myocarde.",
                ),
                Document(
                    15,
                    "Formulation exacte",
                    "Cardiologie",
                    "Suspicion clinique d'infarctus du myocarde chez un patient diabétique.",
                ),
            ]
        )

    def result_ids(self, query: str) -> list[int]:
        return [result.id for result in self.engine.search(query, limit=20)]

    def test_normalizer_folds_accents_and_ligatures(self) -> None:
        self.assertEqual(normalize_medical_french("œdème"), "oedeme")
        self.assertEqual(normalize_medical_french("oedème"), "oedeme")
        self.assertEqual(normalize_medical_french("ŒDÈME"), "oedeme")
        self.assertEqual(normalize_medical_french("ætiologie"), "aetiologie")

    def test_ligature_query_matches_ascii_oedeme_document(self) -> None:
        self.assertIn(2, self.result_ids("œdème"))

    def test_ascii_query_matches_ligature_document(self) -> None:
        self.assertIn(1, self.result_ids("oedeme"))

    def test_accented_query_matches_unaccented_document(self) -> None:
        self.assertIn(2, self.result_ids("oedème périphérique"))

    def test_idm_expands_to_infarctus_du_myocarde(self) -> None:
        self.assertIn(3, self.result_ids("IDM"))

    def test_bpco_expands_to_long_form(self) -> None:
        self.assertIn(4, self.result_ids("BPCO"))

    def test_multiple_required_terms_with_abbreviation_expansion(self) -> None:
        ids = self.result_ids("BPCO exacerbation")
        self.assertIn(4, ids)
        self.assertNotIn(7, ids)

    def test_ambiguous_irc_expands_to_both_meanings(self) -> None:
        ids = self.result_ids("IRC")
        self.assertIn(6, ids)
        self.assertIn(7, ids)
        self.assertEqual(
            ABBREVIATION_EXPANSIONS["IRC"],
            (
                "insuffisance rénale chronique",
                "insuffisance respiratoire chronique",
            ),
        )

    def test_ambiguous_ep_expands_to_both_meanings(self) -> None:
        ids = self.result_ids("EP")
        self.assertIn(10, ids)
        self.assertIn(11, ids)

    def test_phrase_boost_changes_ranking(self) -> None:
        without_boost = self.engine.search(
            "infarctus du myocarde",
            limit=5,
            exact_phrase_boost=0.0,
        )
        with_boost = self.engine.search(
            "infarctus du myocarde",
            limit=5,
            exact_phrase_boost=3.0,
        )

        self.assertEqual(with_boost[0].id, 15)
        self.assertTrue(with_boost[0].exact_phrase_match)
        self.assertNotEqual([r.id for r in without_boost], [r.id for r in with_boost])

    def test_query_builder_contains_or_group_for_ambiguous_abbreviation(self) -> None:
        built = build_query("IRC")
        self.assertIn('"irc"', built.match_query)
        self.assertIn('"insuffisance renale chronique"', built.match_query)
        self.assertIn('"insuffisance respiratoire chronique"', built.match_query)
        self.assertIn(" OR ", built.match_query)

    def test_column_weights_allow_title_match_to_outrank_body_only_match(self) -> None:
        self.engine.add_documents(
            [
                Document(
                    101,
                    "Titre non pertinent",
                    "Divers",
                    "hypertension arterielle hypertension arterielle",
                ),
                Document(
                    102,
                    "Hypertension artérielle",
                    "Divers",
                    "mention courte",
                ),
            ]
        )
        results = self.engine.search("hypertension artérielle", limit=20)
        ordered_ids = [result.id for result in results]
        self.assertLess(ordered_ids.index(102), ordered_ids.index(101))


if __name__ == "__main__":
    unittest.main()
```

## Notes on production use

- Keep the abbreviation table in a versioned data file or database table in a real system, but load it into the same `dict[str, tuple[str, ...]]` shape used here.
- Prefer conservative expansions. An expansion that is frequently wrong can harm precision more than it helps recall.
- For ambiguous abbreviations, log which OR alternatives matched so the UI can explain why a result appeared.
- Consider adding specialty or corpus-specific context filters later, for example preferring renal `IRC` in nephrology sections and respiratory `IRC` in pneumology sections. Do this as a ranking feature, not by deleting ambiguous expansions.
- Rebuild the FTS table if the normalization function changes, because ligature expansion is part of the indexed representation.

## Run command

```bash
python -m unittest -v
```
